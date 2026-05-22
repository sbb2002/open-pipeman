# 프로젝트 구조

## 파일 트리
```
.
├── index.html       # 전체 레이아웃 골격 + 모든 CSS/JS 로드 (JS 로드 순서 = 의존 순서)
├── api.py           # FastAPI 엔드포인트 + SSE 스트리밍. 진입점: uvicorn api:app
├── graph.py         # LangGraph DAG 조립 + 컴파일 (_compiled 인스턴스 생성)
├── nodes.py         # CellState, _llm(), 9개 노드 함수, 조건부 엣지 정의
├── css/
│   ├── base.css     # CSS 변수, 전역 리셋, #app/#main 레이아웃
│   ├── cell.css     # 노드 외형·상태, Lasso, 고스트, Human Review 뱃지
│   ├── inspector.css# Inspector 패널 폼·탭·Result·메모 툴팁
│   ├── layout.css   # 사이드바, 헤더, 캔버스, 줌 컨트롤, 툴 트레이, 상태바
│   ├── overlays.css # 모달, 컨텍스트 메뉴, Confirm, 로드 팝업, 토스트, HR 팝업
│   └── settings.css # 설정 팝업 (테마·폰트·컬러 피커·API Key)
└── js/
    ├── state.js     # 전역 state 객체 + DOM 참조. 모든 JS의 기반
    ├── canvas.js    # 노드 생성·렌더링·드래그·엣지 그리기·툴 모드
    ├── edit.js      # 컨텍스트 메뉴, 연결, 단축키, applyTransform(), 줌/pan
    ├── inspector.js # Inspector 패널: 탭 전환, Apply, validatePipeline(), 결과 표시
    ├── ui.js        # showModal(), showConfirm(), I/O Sync, 메모 툴팁
    ├── settings.js  # 테마·폰트·컬러 설정, Live Preview, HSV 컬러 피커
    ├── store.js     # localStorage CRUD: storeGet/Set/Delete, snapshot, relativeTime
    ├── project-ui.js# 프로젝트 UI + 앱 초기화: 사이드바, 로드 팝업, loadPipeline()
    ├── runner.js    # 실행 엔진: topoSort(), runCell(), runFromNode(), setNodeStatus()
    └── hitl.js      # Human Review: 뱃지, 팝업, resumeCell()
```

---

## 의존성 맵

### Python
```
nodes.py  →  graph.py  →  api.py
```

### JavaScript (로드 순서 엄수)
```
state.js
  ├─▶ canvas.js
  ├─▶ edit.js
  ├─▶ inspector.js
  ├─▶ ui.js
  ├─▶ settings.js
  └─▶ store.js
        └─▶ project-ui.js
                └─▶ runner.js
                       └─▶ hitl.js
```

> **runner.js ↔ hitl.js** 는 서로를 호출하지만, 전역 스크립트 특성상 로드 완료 후 호출되므로 런타임 오류 없음.