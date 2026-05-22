# nodes.py
# Visual AI Pipeline Builder — LangGraph 노드 정의
# 의존: pip install langgraph anthropic openai e2b-code-interpreter python-dotenv

from __future__ import annotations

import json
import re
import textwrap
from typing import Any

import anthropic
from openai import AsyncOpenAI
from langgraph.types import interrupt
from typing_extensions import Annotated, TypedDict

import os
from dotenv import load_dotenv
load_dotenv()

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

MODEL_DEFAULT = "claude-sonnet-4-20250514"
OLLAMA_BASE_URL = "http://localhost:11434/v1"
MAX_RETRIES = 3
MAX_INTENT_RETRIES = 2

# ---------------------------------------------------------------------------
# LangGraph 상태 정의
# ---------------------------------------------------------------------------

class CellState(TypedDict):
    # ── 입력 (파이프라인에서 주입) ──────────────────────────────────────────
    cell_id: str
    prompt: str                          # Cell Config 프롬프트
    model: str                           # 사용할 LLM 모델명
    upstream_schema: dict[str, Any]      # 이전 셀 output_schema (Schema-First)

    # ── 생성물 ───────────────────────────────────────────────────────────────
    generated_code: str
    wrapped_code: str
    docstring: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]

    # ── 검증 상태 ────────────────────────────────────────────────────────────
    intent_ok: bool
    intent_feedback: str
    exec_ok: bool
    exec_error: str
    retry_count: int

    # ── 흐름 제어 ────────────────────────────────────────────────────────────
    status: str                          # pending | running | paused | done | failed
    hr_action: str                       # human_review 결정: '' | 'approved' | 'rewrite'
    stage: str                           # 현재 단계명 (스트리밍용)
    stream_log: Annotated[list[str], lambda a, b: a + b]


# ---------------------------------------------------------------------------
# LLM 클라이언트 — 지연 초기화 + 모델 분기
# ---------------------------------------------------------------------------

_anthropic_client: anthropic.AsyncAnthropic | None = None
_ollama_client: AsyncOpenAI | None = None


def _is_ollama(model: str) -> bool:
    """claude- / gpt- / gemini- 로 시작하지 않으면 Ollama 모델로 간주한다."""
    return not any(model.startswith(p) for p in ("claude-", "gpt-", "gemini-"))


async def _llm(system: str, user: str, max_tokens: int = 2048, model: str = MODEL_DEFAULT) -> str:
    """
    모델명에 따라 Anthropic 또는 Ollama(OpenAI 호환)로 분기하는 비동기 LLM 호출.
    클라이언트는 첫 호출 시점에 초기화(지연 초기화)하므로
    API Key가 없어도 백엔드 시작이 실패하지 않는다.
    """
    global _anthropic_client, _ollama_client

    if _is_ollama(model):
        if _ollama_client is None:
            _ollama_client = AsyncOpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")
        resp = await _ollama_client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
        )
        return resp.choices[0].message.content.strip()
    else:
        if _anthropic_client is None:
            _anthropic_client = anthropic.AsyncAnthropic()
        msg = await _anthropic_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return msg.content[0].text.strip()


def _extract_code(raw: str) -> str:
    """LLM 응답에서 코드 블록만 추출 (Sanitizer)."""
    match = re.search(r"```(?:python)?\n?(.*?)```", raw, re.DOTALL)
    return match.group(1).strip() if match else raw.strip()


# ---------------------------------------------------------------------------
# 노드 0 : 스키마 주입 (Schema-First)
# ---------------------------------------------------------------------------

async def node_inject_schema(state: CellState) -> dict:
    """이전 셀의 output_schema를 프롬프트 컨텍스트에 병합한다."""
    upstream = state.get("upstream_schema", {})
    schema_hint = (
        f"upstream output schema: {json.dumps(upstream, ensure_ascii=False)}"
        if upstream
        else "this is the first (INPUT) cell — no upstream schema"
    )
    enriched_prompt = f"{state['prompt']}\n\n[SCHEMA CONTEXT]\n{schema_hint}"
    return {
        "prompt": enriched_prompt,
        "stage": "schema_inject",
        "stream_log": [f"[schema_inject] model={state.get('model', MODEL_DEFAULT)} upstream_schema={json.dumps(upstream)}"],
    }


# ---------------------------------------------------------------------------
# 노드 1 : 코드 생성
# ---------------------------------------------------------------------------

async def node_generate(state: CellState) -> dict:
    """Cell Config 프롬프트를 바탕으로 Python 코드를 생성한다."""
    system = textwrap.dedent("""
        You are a code-generation engine for a visual dataflow pipeline.
        Rules:
        - Return ONLY a raw Python code block (```python ... ```). No explanation.
        - The code must be a pure function that accepts typed inputs and returns a dict.
        - Do NOT use print() for output — return values only.
        - Respect the upstream schema context provided by the user.
    """)
    feedback = state.get("intent_feedback", "") or state.get("exec_error", "")
    user = state["prompt"]
    if feedback:
        user += f"\n\n[PREVIOUS FEEDBACK — fix this]\n{feedback}"

    model = state.get("model", MODEL_DEFAULT)
    raw = await _llm(system, user, model=model)
    code = _extract_code(raw)
    return {
        "generated_code": code,
        "stage": "generate",
        "stream_log": [f"[generate] code generated ({len(code)} chars)"],
    }


# ---------------------------------------------------------------------------
# 노드 2 : 의도 검증
# ---------------------------------------------------------------------------

async def node_validate_intent(state: CellState) -> dict:
    """생성된 코드가 사용자 의도를 충족하는지 LLM이 판단한다."""
    system = textwrap.dedent("""
        You are a strict code reviewer for a pipeline node.
        Given the user's intent and the generated code, decide:
        - Reply with exactly "PASS" if the code satisfies the intent.
        - Reply with "FAIL: <concise reason>" if it does not.
        Do NOT add anything else.
    """)
    user = (
        f"[USER INTENT]\n{state['prompt']}\n\n"
        f"[GENERATED CODE]\n```python\n{state['generated_code']}\n```"
    )
    model = state.get("model", MODEL_DEFAULT)
    verdict = await _llm(system, user, max_tokens=256, model=model)
    ok = verdict.strip().upper().startswith("PASS")
    feedback = "" if ok else verdict.replace("FAIL:", "").strip()
    retry = state.get("retry_count", 0) + (0 if ok else 1)
    return {
        "intent_ok": ok,
        "intent_feedback": feedback,
        "retry_count": retry,
        "stage": "validate_intent",
        "stream_log": [f"[validate_intent] {'PASS' if ok else 'FAIL — ' + feedback}"],
    }


# ---------------------------------------------------------------------------
# 노드 3 : 코드 실행 검증 (E2B 샌드박스)
# ---------------------------------------------------------------------------

from e2b_code_interpreter import AsyncSandbox

async def node_execute(state: CellState) -> dict:
    code = state["generated_code"]
    ok = False
    error_msg = ""

    sandbox = await AsyncSandbox.create()
    try:
        result = await sandbox.run_code(code)
        ok = not result.error
        error_msg = result.error.value if result.error else ""
    except Exception as e:
        error_msg = str(e)
    finally:
        await sandbox.kill()

    retry = state.get("retry_count", 0) + (0 if ok else 1)
    return {
        "exec_ok": ok,
        "exec_error": error_msg,
        "retry_count": retry,
        "stage": "execute",
        "stream_log": [f"[execute] {'OK' if ok else 'ERROR — ' + error_msg}"],
    }


# ---------------------------------------------------------------------------
# 노드 4 : 래핑
# ---------------------------------------------------------------------------

async def node_wrap(state: CellState) -> dict:
    """검증된 코드를 재사용 가능한 함수/클래스로 래핑하고 스키마를 추론한다."""
    system = textwrap.dedent("""
        You are a Python refactoring assistant.
        Task:
        1. Wrap the given code in a single well-named function or class.
        2. Add type annotations to all parameters and the return type.
        3. Return ONLY a JSON object with three keys:
           - "code": the wrapped Python code as a string (escaped \\n for newlines)
           - "input_schema":  {"param_name": "type_str", ...}
           - "output_schema": {"key": "type_str", ...}
        No markdown, no explanation.
    """)
    model = state.get("model", MODEL_DEFAULT)
    raw = await _llm(system, f"```python\n{state['generated_code']}\n```", max_tokens=2048, model=model)
    raw_clean = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
    try:
        parsed = json.loads(raw_clean)
        wrapped = parsed.get("code", state["generated_code"])
        in_schema = parsed.get("input_schema", {})
        out_schema = parsed.get("output_schema", {})
    except json.JSONDecodeError:
        wrapped = _extract_code(raw) or state["generated_code"]
        in_schema, out_schema = {}, {}

    return {
        "wrapped_code": wrapped,
        "input_schema": in_schema,
        "output_schema": out_schema,
        "stage": "wrap",
        "stream_log": [f"[wrap] input_schema={in_schema} output_schema={out_schema}"],
    }


# ---------------------------------------------------------------------------
# 노드 5 : Docstring 작성
# ---------------------------------------------------------------------------

async def node_docstring(state: CellState) -> dict:
    """래핑된 코드에 Google-style Docstring을 삽입한다."""
    system = textwrap.dedent("""
        Add a Google-style docstring to the given Python function/class.
        Include: summary, Args, Returns, Raises sections.
        Return ONLY the complete Python code with the docstring inserted.
        No markdown fences, no explanation.
    """)
    model = state.get("model", MODEL_DEFAULT)
    raw = await _llm(system, state["wrapped_code"], max_tokens=2048, model=model)
    code_with_doc = _extract_code(raw) or raw
    doc_match = re.search(r'"""(.*?)"""', code_with_doc, re.DOTALL)
    docstring = doc_match.group(1).strip() if doc_match else ""
    return {
        "wrapped_code": code_with_doc,
        "docstring": docstring,
        "stage": "docstring",
        "stream_log": [f"[docstring] docstring written ({len(docstring)} chars)"],
    }


# ---------------------------------------------------------------------------
# 노드 6 : 코드 갈무리
# ---------------------------------------------------------------------------

async def node_cleanup(state: CellState) -> dict:
    """미사용 변수와 불필요한 주석을 제거하여 코드를 정리한다."""
    system = textwrap.dedent("""
        Clean up the following Python code:
        - Remove unused variables and imports.
        - Shorten or remove redundant inline comments (keep the docstring intact).
        - Do NOT change logic or rename public identifiers.
        Return ONLY the cleaned Python code. No markdown, no explanation.
    """)
    model = state.get("model", MODEL_DEFAULT)
    raw = await _llm(system, state["wrapped_code"], max_tokens=2048, model=model)
    cleaned = _extract_code(raw) or raw
    return {
        "wrapped_code": cleaned,
        "stage": "cleanup",
        "stream_log": [f"[cleanup] cleanup done ({len(cleaned)} chars)"],
    }


# ---------------------------------------------------------------------------
# 노드 7 : 결과 반환
# ---------------------------------------------------------------------------

async def node_finalize(state: CellState) -> dict:
    """최종 결과를 파이프라인 규격 JSON으로 패키징한다."""
    return {
        "status": "done",
        "stage": "finalize",
        "stream_log": [
            "[finalize] "
            + json.dumps(
                {
                    "cell_id": state["cell_id"],
                    "input_schema": state.get("input_schema", {}),
                    "output_schema": state.get("output_schema", {}),
                },
                ensure_ascii=False,
            )
        ],
    }


# ---------------------------------------------------------------------------
# FAILED 노드
# ---------------------------------------------------------------------------

async def node_failed(state: CellState) -> dict:
    """재시도 상한 초과 시 셀을 FAILED 상태로 전이한다."""
    reason = state.get("exec_error") or state.get("intent_feedback") or "unknown"
    return {
        "status": "failed",
        "stage": "failed",
        "stream_log": [f"[failed] max_retries({MAX_RETRIES}) exceeded. last_error={reason}"],
    }


# ---------------------------------------------------------------------------
# 조건부 엣지
# ---------------------------------------------------------------------------

def edge_after_intent(state: CellState) -> str:
    if state["retry_count"] >= MAX_RETRIES:
        return "failed"
    if not state["intent_ok"]:
        return "generate"
    return "execute"


def edge_after_execute(state: CellState) -> str:
    if state["retry_count"] >= MAX_RETRIES:
        return "failed"
    if not state["exec_ok"]:
        return "generate"
    return "wrap"


# ---------------------------------------------------------------------------
# Human-in-the-loop
# ---------------------------------------------------------------------------

async def node_human_review(state: CellState) -> dict:
    """
    Human-in-the-loop 인터럽트 노드.
    interrupt()로 그래프를 일시정지하고 프론트의 paused 이벤트를 트리거한다.
    resume 시 반환값으로 승인/재작성을 판정한다.
    """
    code = state.get("generated_code", "")

    resume_payload = interrupt({
        "code": code,
        "message": "Human review required.",
    })

    comment = None
    if isinstance(resume_payload, dict):
        comment = resume_payload.get("updated_code")

    if comment:
        return {
            "hr_action": "rewrite",
            "intent_feedback": comment,
            "exec_ok": False,
            "retry_count": 0,
            "stage": "human_review",
            "stream_log": [f"[human_review] rewrite requested ({len(comment)} chars)"],
        }
    else:
        return {
            "hr_action": "approved",
            "stage": "human_review",
            "stream_log": [f"[human_review] approved ({len(code)} chars)"],
        }


def edge_after_human_review(state: CellState) -> str:
    if state.get('hr_action') == 'rewrite':
        return 'generate'
    return 'wrap'