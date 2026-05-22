# graph.py
# Visual AI Pipeline Builder — LangGraph DAG 조립 및 컴파일

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from nodes import (
    CellState,
    node_inject_schema, node_generate, node_validate_intent,
    node_execute, node_classify_level, node_human_review, node_wrap, node_docstring,
    node_cleanup, node_finalize, node_failed,
    edge_after_intent, edge_after_execute, edge_after_classify, edge_after_human_review,
)

# ---------------------------------------------------------------------------
# 그래프 조립
# ---------------------------------------------------------------------------

def build_graph(allow_cleanup: bool = False) -> StateGraph:
    g = StateGraph(CellState)

    g.add_node("inject_schema",   node_inject_schema)
    g.add_node("generate",        node_generate)
    g.add_node("validate_intent", node_validate_intent)
    g.add_node("execute",         node_execute)
    g.add_node("classify_level",  node_classify_level)
    g.add_node("human_review",    node_human_review)
    g.add_node("wrap",            node_wrap)
    g.add_node("docstring",       node_docstring)
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
        {"generate": "generate", "classify_level": "classify_level", "failed": "failed"},
    )
    g.add_conditional_edges(
        "classify_level",
        edge_after_classify,
        {"human_review": "human_review", "wrap": "wrap"},
    )
    g.add_conditional_edges(
        "human_review",
        edge_after_human_review,
        {"generate": "generate", "wrap": "wrap"},
    )
    g.add_edge("wrap", "docstring")

    if allow_cleanup:
        g.add_node("cleanup", node_cleanup)
        g.add_edge("docstring", "cleanup")
        g.add_edge("cleanup",   "finalize")
    else:
        g.add_edge("docstring", "finalize")

    g.add_edge("finalize", END)
    g.add_edge("failed",   END)

    return g


_checkpointer = MemorySaver()
_compiled = build_graph().compile(checkpointer=_checkpointer)