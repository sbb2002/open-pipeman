# backend.py
# Visual AI Pipeline Builder - Backend Execution Engine
# 의존성: pip install fastapi uvicorn langgraph anthropic openai

from __future__ import annotations

import ast
import io
import json
import re
import textwrap
import traceback
from contextlib import redirect_stdout, redirect_stderr
from typing import Any, AsyncGenerator

import anthropic
from openai import AsyncOpenAI
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field
from typing_extensions import Annotated, TypedDict

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
            # Ollama는 인증 불필요 — api_key는 형식 맞추기용 더미값
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
# 노드 3 : 코드 실행 검증 (샌드박스)
# ---------------------------------------------------------------------------

async def node_execute(state: CellState) -> dict:
    """생성된 코드를 격리된 namespace에서 실행하여 런타임 오류를 검증한다."""
    code = state["generated_code"]
    stdout_buf, stderr_buf = io.StringIO(), io.StringIO()
    namespace: dict[str, Any] = {}
    error_msg = ""
    ok = False

    try:
        ast.parse(code)
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(compile(code, "<cell>", "exec"), namespace)  # noqa: S102
        ok = True
    except SyntaxError as e:
        error_msg = f"SyntaxError at line {e.lineno}: {e.msg}"
    except Exception:
        tb_lines = traceback.format_exc().splitlines()
        error_msg = "\n".join(tb_lines[-3:])

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
    실행 검증 직후 interrupt() 를 호출하여 그래프를 일시정지한다.
    Resume 전 update_state() 로 generated_code 를 교체할 수 있다.
    """
    interrupt({
        "cell_id": state["cell_id"],
        "stage": "human_review",
        "code": state["generated_code"],
        "message": "코드를 확인하세요. 수정 후 Resume하거나 그대로 Run을 누르세요.",
    })
    return {
        "stage": "human_review",
        "stream_log": ["[human_review] paused — waiting for user"],
    }


# ---------------------------------------------------------------------------
# 그래프 조립
# ---------------------------------------------------------------------------

def build_graph() -> StateGraph:
    g = StateGraph(CellState)

    g.add_node("inject_schema",   node_inject_schema)
    g.add_node("generate",        node_generate)
    g.add_node("validate_intent", node_validate_intent)
    g.add_node("execute",         node_execute)
    g.add_node("human_review",    node_human_review)
    g.add_node("wrap",            node_wrap)
    g.add_node("docstring",       node_docstring)
    g.add_node("cleanup",         node_cleanup)
    g.add_node("finalize",        node_finalize)
    g.add_node("failed",          node_failed)

    g.add_edge(START,            "inject_schema")
    g.add_edge("inject_schema",  "generate")
    g.add_edge("generate",       "validate_intent")

    g.add_conditional_edges(
        "validate_intent",
        edge_after_intent,
        {"generate": "generate", "execute": "execute", "failed": "failed"},
    )
    g.add_conditional_edges(
        "execute",
        edge_after_execute,
        {"generate": "generate", "wrap": "human_review", "failed": "failed"},
    )

    g.add_edge("human_review", "wrap")
    g.add_edge("wrap",         "docstring")
    g.add_edge("docstring",    "cleanup")
    g.add_edge("cleanup",      "finalize")
    g.add_edge("finalize",     END)
    g.add_edge("failed",       END)

    return g


_checkpointer = MemorySaver()
_compiled = build_graph().compile(checkpointer=_checkpointer)


# ---------------------------------------------------------------------------
# FastAPI 앱
# ---------------------------------------------------------------------------

app = FastAPI(title="Visual AI Pipeline Builder — Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 요청 / 응답 모델 ──────────────────────────────────────────────────────

class RunCellRequest(BaseModel):
    cell_id: str
    prompt: str
    model: str = MODEL_DEFAULT
    upstream_schema: dict[str, Any] = Field(default_factory=dict)


class ResumeCellRequest(BaseModel):
    cell_id: str
    updated_code: str | None = None


class CellResult(BaseModel):
    cell_id: str
    status: str
    code: str
    docstring: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    logs: list[str]


# ── SSE 헬퍼 ──────────────────────────────────────────────────────────────

def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── 스트리밍 실행 제너레이터 ───────────────────────────────────────────────

async def _stream_run(
    thread_id: str,
    initial_state: CellState | None = None,
) -> AsyncGenerator[str, None]:
    config = {"configurable": {"thread_id": thread_id}}
    invoke_kwargs: dict[str, Any] = {"config": config}
    if initial_state is not None:
        invoke_kwargs["input"] = initial_state

    async for event in _compiled.astream_events(**invoke_kwargs, version="v2"):
        kind = event["event"]

        if kind == "on_chain_start" and event.get("name") in (
            "inject_schema", "generate", "validate_intent",
            "execute", "human_review", "wrap", "docstring", "cleanup",
            "finalize", "failed",
        ):
            yield _sse("stage_start", {"stage": event["name"]})

        elif kind == "on_chain_end" and "output" in event.get("data", {}):
            output = event["data"]["output"]
            if not isinstance(output, dict):
                continue

            logs = output.get("stream_log", [])
            if logs:
                yield _sse("log", {"logs": logs})

            if event.get("name") == "human_review":
                yield _sse("paused", {
                    "stage": "human_review",
                    "code": output.get("generated_code", ""),
                })

            if output.get("status") in ("done", "failed"):
                yield _sse("result", {
                    "cell_id": output.get("cell_id", ""),
                    "status": output["status"],
                    "code": output.get("wrapped_code", ""),
                    "docstring": output.get("docstring", ""),
                    "input_schema": output.get("input_schema", {}),
                    "output_schema": output.get("output_schema", {}),
                    "logs": output.get("stream_log", []),
                })
    yield _sse("done", {})


# ── 엔드포인트 ────────────────────────────────────────────────────────────

@app.post("/cell/run")
async def run_cell(req: RunCellRequest):
    """셀 실행 시작 (Run 버튼). SSE 스트림으로 각 단계 진행 상황을 실시간 전달한다."""
    initial_state: CellState = {
        "cell_id": req.cell_id,
        "prompt": req.prompt,
        "model": req.model,
        "upstream_schema": req.upstream_schema,
        "generated_code": "",
        "wrapped_code": "",
        "docstring": "",
        "input_schema": {},
        "output_schema": {},
        "intent_ok": False,
        "intent_feedback": "",
        "exec_ok": False,
        "exec_error": "",
        "retry_count": 0,
        "status": "running",
        "stage": "start",
        "stream_log": [],
    }
    return StreamingResponse(
        _stream_run(req.cell_id, initial_state),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/cell/stop/{cell_id}")
async def stop_cell(cell_id: str):
    """Stop 버튼 — 체크포인트는 MemorySaver에 보존된다."""
    snapshot = _compiled.get_state({"configurable": {"thread_id": cell_id}})
    if not snapshot:
        raise HTTPException(status_code=404, detail="cell not found or already done")
    return {"cell_id": cell_id, "status": "paused", "stage": snapshot.values.get("stage")}


@app.post("/cell/resume")
async def resume_cell(req: ResumeCellRequest):
    """Resume 버튼. updated_code 가 있으면 상태에 주입 후 재개."""
    config = {"configurable": {"thread_id": req.cell_id}}
    if req.updated_code is not None:
        _compiled.update_state(
            config,
            {"generated_code": req.updated_code, "exec_ok": True, "exec_error": ""},
            as_node="human_review",
        )
    return StreamingResponse(
        _stream_run(req.cell_id, initial_state=None),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/cell/state/{cell_id}", response_model=CellResult)
async def get_cell_state(cell_id: str):
    """현재 셀의 체크포인트 상태를 조회한다."""
    snapshot = _compiled.get_state({"configurable": {"thread_id": cell_id}})
    if not snapshot:
        raise HTTPException(status_code=404, detail="cell not found")
    v = snapshot.values
    return CellResult(
        cell_id=v.get("cell_id", cell_id),
        status=v.get("status", "unknown"),
        code=v.get("wrapped_code", ""),
        docstring=v.get("docstring", ""),
        input_schema=v.get("input_schema", {}),
        output_schema=v.get("output_schema", {}),
        logs=v.get("stream_log", []),
    )


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend:app", host="0.0.0.0", port=8000, reload=True)