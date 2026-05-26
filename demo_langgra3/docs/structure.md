# 프로젝트 구조

## 파일 트리
```
.
├── index.html       # 전체 레이아웃 골격 + 모든 CSS/JS 로드 (JS 로드 순서 = 의존 순서)
├── api.py           # FastAPI 엔드포인트 + SSE 스트리밍. 진입점: uvicorn api:app
├── graph.py         # LangGraph DAG 조립 + 컴파일 (_compiled 인스턴스 생성)
├── nodes.py         # CellState, _llm(), 노드 함수, 조건부 엣지 정의
├── css/
│   ├── base.css     # CSS 변수, 전역 리셋, #app/#main 레이아웃
│   ├── cell.css     # 노드 외형·상태, Lasso, 고스트, Human Review 뱃지
│   ├── inspector.css# Inspector 패널 폼·탭·Result·메모 툴팁
│   ├── layout.css   # 사이드바, 헤더, 캔버스, 줌 컨트롤, 툴 트레이, 에러 로그 버튼·패널
│   ├── overlays.css # 모달, 컨텍스트 메뉴, Confirm, 로드 팝업, 토스트, HR 팝업
│   └── settings.css # 설정 팝업 (테마·폰트·컬러 피커·API Key·Max Retries 슬라이더)
└── js/
    ├── state.js     # 전역 state 객체 + DOM 참조. 모든 JS의 기반
    ├── canvas.js    # 노드 생성·렌더링·드래그·엣지 그리기·툴 모드
    ├── edit.js      # 컨텍스트 메뉴, 연결, 단축키, applyTransform(), 줌/pan
    ├── inspector.js # Inspector 패널: 탭 전환, Apply, validatePipeline(), 결과 표시
    ├── ui.js        # showModal(), showConfirm(), I/O Sync, 메모 툴팁
    ├── settings.js  # 테마·폰트·컬러 설정, getHRStrictness(), getMaxRetries(), HSV 컬러 피커
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

---

## 주요 데이터 흐름

### LangGraph 노드 실행 순서
```
inject_schema
  └─▶ (allow_web_search=true) search_tools
        └─▶ generate
  └─▶ (allow_web_search=false) generate
        └─▶ validate_intent
              └─▶ (PASS) execute
                    └─▶ classify_level
                          └─▶ (need_review | license_review) human_review
                                └─▶ (approved) wrap → docstring → [cleanup] → finalize
                                └─▶ (rewrite)  generate (재시도)
                          └─▶ (skip) wrap → docstring → [cleanup] → finalize
              └─▶ (FAIL) generate (재시도)
        └─▶ (max_retries 초과) failed
```

### CellState 주요 필드
| 필드 | 타입 | 설명 |
|---|---|---|
| `allow_web_search` | bool | Cell Config 체크박스 — PyPI/HF 도구 탐색 활성화 |
| `tool_hint` | str | search_tools가 생성한 추천 라이브러리/모델 힌트 |
| `license_review` | bool | non-permissive 라이선스 발견 시 True → HR 트리거 |
| `max_retries` | int | 설정 패널 슬라이더 값. 0=no limit, 기본 3 |
| `force_review` | bool | Cell Config 체크박스 — 레벨 무관 강제 HR |
| `hr_strictness` | str | 'low'\|'medium'\|'high' — 설정 패널 슬라이더 |
| `e2b_api_key` | str | E2B 샌드박스 API 키 (api.py에서 env로 주입) |

---

## UI 변경 이력 (주요)

| 항목 | 변경 내용 |
|---|---|
| `#statusbar` | **제거됨.** 하단 상태바 영역 전체 삭제 |
| `#status-ws` | **제거됨.** WS 연결 상태 표시 span (JS 참조 없던 dead element) |
| `#status-validity` | **이동됨.** statusbar → 캔버스 좌하단 플로팅 버튼(`#error-log-btn-wrap`) |
| `#error-panel` | **재배치됨.** 전체 하단 슬라이드 → 에러 로그 버튼 위에서 올라오는 팝업 (width: 360px, left: 14px, bottom: 50px) |
| Settings > Strictness 탭 | **CODE REVIEW 섹션 추가.** Max Retries 5단계 quantized 슬라이더 (3/5/10/20/No limit) + 직접 입력 텍스트박스 |
| Cell Config | **Allow Web Search 체크박스 추가.** 활성화 시 PyPI/HuggingFace 도구 탐색 후 코드 생성에 반영. non-permissive 라이선스 발견 시 HR 트리거 |
| `runner.js` body | `allow_web_search`, `max_retries` 추가. `e2b_api_key` 제거 (서버 env 처리) |

---

## 백엔드 API 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/cell/run` | 셀 실행 시작. SSE 스트림 반환 |
| POST | `/cell/stop/{cell_id}` | 실행 중단 (체크포인트 보존) |
| POST | `/cell/resume` | HR 인터럽트 후 재개 |
| GET | `/cell/state/{cell_id}` | 체크포인트 상태 조회 |

### RunCellRequest 필드
```python
cell_id, prompt, model, upstream_schema,
allow_cleanup, force_review, hr_strictness,
allow_web_search, max_retries
```