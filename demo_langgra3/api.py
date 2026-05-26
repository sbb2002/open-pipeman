# api.py
# Visual AI Pipeline Builder — FastAPI 엔드포인트 및 SSE 스트리밍
# 실행: python api.py  또는  uvicorn api:app --reload

from __future__ import annotations

import json
import os
from typing import Any, AsyncGenerator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.types import Command
from pydantic import BaseModel, Field

from nodes import CellState, MODEL_DEFAULT
from graph import _compiled

from dotenv import load_dotenv
load_dotenv()

E2B_API_KEY = os.getenv("E2B_API_KEY")

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
    allow_cleanup: bool = False
    force_review: bool = False
    hr_strictness: str = "low"
    allow_web_search: bool = False
    max_retries: int = 3


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

NODE_NAMES = {
    "inject_schema", "search_tools", "generate", "validate_intent",
    "execute", "human_review", "wrap", "docstring", "cleanup",
    "finalize", "failed",
}


# ── 공통 스트림 처리 ───────────────────────────────────────────────────────

async def _stream_iter(
    astream_input: Any,
    config: dict,
    thread_id: str,
) -> AsyncGenerator[str, None]:
    """
    _compiled.astream()의 결과를 SSE 이벤트로 변환한다.
    astream_input: 초기 state dict(신규 실행) 또는 Command(resume) 중 하나.
    """
    async for chunk in _compiled.astream(astream_input, config=config, stream_mode="updates"):
        if "__interrupt__" in chunk:
            interrupts = chunk["__interrupt__"]
            intr = interrupts[0] if interrupts else None
            intr_value = intr.value if (intr and hasattr(intr, "value")) else {}

            snapshot = _compiled.get_state(config)
            sv = snapshot.values if snapshot else {}

            yield _sse("stage_start", {"stage": "human_review"})
            yield _sse("log", {"logs": [
                f"[human_review] interrupt — awaiting human decision "
                f"({len(sv.get('generated_code', ''))} chars)"
            ]})
            yield _sse("paused", {
                "code": sv.get("generated_code", intr_value.get("code", "") if isinstance(intr_value, dict) else ""),
                "message": intr_value.get("message", "Human review required.") if isinstance(intr_value, dict) else "Human review required.",
                "cell_id": sv.get("cell_id", thread_id),
            })
            yield _sse("done", {})
            return

        for node_name, output in chunk.items():
            if node_name not in NODE_NAMES:
                continue
            if not isinstance(output, dict):
                continue

            yield _sse("stage_start", {"stage": node_name})

            logs = output.get("stream_log", [])
            if logs:
                yield _sse("log", {"logs": logs})

            if output.get("status") in ("done", "failed"):
                snapshot = _compiled.get_state(config)
                sv = snapshot.values if snapshot else {}
                yield _sse("result", {
                    "cell_id": sv.get("cell_id", thread_id),
                    "status": output["status"],
                    "code": sv.get("wrapped_code", ""),
                    "docstring": sv.get("docstring", ""),
                    "input_schema": sv.get("input_schema", {}),
                    "output_schema": sv.get("output_schema", {}),
                    "logs": sv.get("stream_log", []),
                })

    yield _sse("done", {})


# ── 엔드포인트 ────────────────────────────────────────────────────────────

@app.post("/cell/run")
async def run_cell(req: RunCellRequest):
    """셀 실행 시작 (Run 버튼). SSE 스트림으로 각 단계 진행 상황을 실시간 전달한다."""
    config = {"configurable": {"thread_id": req.cell_id}}
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
        "allow_cleanup":    req.allow_cleanup,
        "force_review":     req.force_review,
        "hr_strictness":    req.hr_strictness,
        "allow_web_search": req.allow_web_search,
        "max_retries":      req.max_retries if req.max_retries > 0 else 999,
        "tool_hint":        "",
        "license_review":   False,
        "e2b_api_key":      E2B_API_KEY or "",
        "code_level":       0,
        "status": "running",
        "hr_action": "",
        "stage": "start",
        "stream_log": [],
    }
    return StreamingResponse(
        _stream_iter(initial_state, config, req.cell_id),
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
    """Resume 버튼. interrupt()로 중단된 그래프를 Command(resume=...)로 재개한다."""
    config = {"configurable": {"thread_id": req.cell_id}}
    resume_value: dict[str, Any] = {"action": "approved"}
    if req.updated_code is not None:
        resume_value["updated_code"] = req.updated_code
        resume_value["action"] = "rewrite"

    return StreamingResponse(
        _stream_iter(Command(resume=resume_value), config, req.cell_id),
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
    if not E2B_API_KEY:
        print("E2B_API_KEY not set — node_execute will fall back to static analysis")
    else:
        print(f"E2B_API_KEY loaded ({E2B_API_KEY[:8]}...)")

    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)