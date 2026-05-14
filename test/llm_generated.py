import json
import asyncio
from typing import Annotated, TypedDict, List, Dict, Any
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from langgraph.graph import StateGraph, END
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage

app = FastAPI()

# 프론트엔드와의 통신을 위한 CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. LangGraph 상태 정의 (노드 간 공유 데이터)
class GraphState(TypedDict):
    # 메시지 리스트와 현재 실행 중인 노드 정보 등을 담습니다.
    messages: List[BaseMessage]
    current_node: str
    payload: Dict[str, Any]

# 2. 노드 로직 정의 (프론트엔드 노드 타입에 매핑될 실제 함수들)
async def llm_node(state: GraphState):
    print(f"--- Executing LLM Node: {state['current_node']} ---")
    # 실제 환경에서는 여기서 LLM을 호출합니다.
    return {"messages": [AIMessage(content="LLM이 처리한 결과입니다.")]}

async def tool_node(state: GraphState):
    print(f"--- Executing Tool Node: {state['current_node']} ---")
    return {"messages": [AIMessage(content="도구 실행이 완료되었습니다.")]}

async def input_node(state: GraphState):
    return state

async def output_node(state: GraphState):
    return state

# 노드 타입별 함수 매핑 테이블
NODE_LOGIC_MAP = {
    "llm": llm_node,
    "tool": tool_node,
    "input": input_node,
    "output": output_node
}

# 3. 그래프 빌더 함수
def create_langgraph(frontend_data: Dict):
    workflow = StateGraph(GraphState)
    
    nodes = frontend_data.get("nodes", [])
    edges = frontend_data.get("edges", [])
    
    # 노드 추가
    for node in nodes:
        node_id = str(node["id"])
        node_type = node.get("type", "llm")
        logic = NODE_LOGIC_MAP.get(node_type, llm_node)
        workflow.add_node(node_id, logic)
    
    # 엣지 추가
    for edge in edges:
        workflow.add_edge(str(edge["source"]), str(edge["target"]))
    
    # 시작점 설정 (type이 input인 노드 찾기)
    input_node_obj = next((n for n in nodes if n["type"] == "input"), None)
    if input_node_obj:
        workflow.set_entry_point(str(input_node_obj["id"]))
    else:
        # input 노드가 없으면 첫 번째 노드를 시작점으로 함
        workflow.set_entry_point(str(nodes[0]["id"]))
        
    return workflow.compile()

# 4. 실행 및 스트리밍 엔드포인트
@app.post("/run")
async def run_pipeline(request: Request):
    data = await request.json()
    graph = create_langgraph(data)
    
    async def event_generator():
        initial_state = {
            "messages": [HumanMessage(content="실행 시작")],
            "payload": data.get("initial_data", {})
        }
        
        # 그래프 실행 및 상태 스트리밍
        async for event in graph.astream(initial_state, stream_mode="updates"):
            for node_id, update in event.items():
                # 현재 어떤 노드가 완료되었는지 프론트엔드에 전달
                yield f"data: {json.dumps({'node_id': node_id, 'status': 'completed', 'update': str(update)})}\n\n"
                await asyncio.sleep(0.5) # 시각적 효과를 위한 짧은 대기
                
        yield "data: {\"status\": \"finished\"}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)