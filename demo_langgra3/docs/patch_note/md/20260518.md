# Patch Note

## 260514
- 드래그로 셀 복수 선택 기능 추가
- 이동모드(녹색 테두리)에서 J키를 누르면 연결모드(파란 테두리)로 진입하는 기능 추가
- Claude의 토큰사용량을 줄이기 위해 structure.md와 modify_manual.md를 제작하여 이를 참고하도록 함. 앞으로 수정 시 수정이 필요한 파일만 요청할듯!

## 260515
- 셀 연결모드 중 이미 연결한 셀을 한번 더 클릭 시 해제하는 기능 추가.

### session 1. Run과 Stop 버튼 구현 방법
| 파일 | 버전 | 내용 |
|------|------|------|
| `js/canvas.js` | v1 | 노드 `mousedown` 핸들러에 `connectingFromMulti !== null` 차단 조건 추가 |
| `js/canvas.js` | v2 | 멀티 연결모드에서 이미 연결된 엣지 클릭 시 재연결 대신 토글(해제)로 변경 |
| `js/edit.js` | v1 | J키 단일 선택 연결모드 진입 시 `multi-selected` 클래스 제거 후 `connecting-source` 추가 |
| `js/edit.js` | v2 | 멀티 연결모드 진입 시 `state.selectedNodes.clear()` 추가 |

### session 2. 셀 선택 후 연결모드 전환 버그 수정
| 파일명 | 버전 | 내용 |
|---|---|---|
| css/layout.css | v1 | `.status-validity-btn` 포커스 시 브라우저 기본 흰색 배경 차단 (`outline: none`, `:focus`/`:focus-visible` 명시) |
| js/canvas.js | v1 | `resizeCanvas()` 즉시 호출 → `requestAnimationFrame`으로 변경하여 초기 로드 시 연결선 미표시 버그 수정 |
| js/inspector.js | v1 | `validatePipeline()` 내 노드 검사 로직 수정 — INPUT/OUTPUT 셀에 `model`·`prompt` 필수 검사 제외, 노드 이름 없을 시 `Cell ${id}` 폴백 추가 |
| js/pipeline.js | v1 | Run/Stop 시뮬레이션 구현 — 위상 정렬(Kahn's) 기반 순차 실행, 타이머 추적(`_runTimeouts`)으로 Stop 즉시 취소, Run 재시작 시 상태 초기화, `btnRun` 비활성화 복원 |
| js/pipeline.js | v2 | `closeInspector` 미정의 에러 수정 — `typeof` 가드 적용 |

### session 3. Run, Stop 애니메이션 수정
- 패치 실패. session 2까지의 작업물까지 완전히 꼬여버림. 최악의 경우, demo-langgra2에 있는걸로 롤백이 필요할 수 있음.
- 추측: claude가 수정이 누적될수록 처음에 주었던 파일을 기준으로 줄넘버를 카운팅하여 잘못된 영역을 수정하게 하는 것 같음. 이게 확실하다면 수정 메뉴얼을 강화해야할 것 같음.
- 수정 메뉴얼 강화 제안으로는 json form에서 줄넘버말고도 "former indent + 앞에 10글자"를 줘서 대조하게 만들어서 완전히 똑같으면 작업하도록 해야겠음.
- modify_manual.md와 patch_applier.py를 다시 제작해야 함.
- 오늘은 토큰 다 써서 여기까지. 그래도 확실히 필요할 때만 파일 제공해주는 현재 방법론이 토큰 소모량을 많이 줄이긴 하였음.

## 260518

### Session 1. 셀의 점모양 원 CSS 요소
| 파일명 | 버전 | 수정 내역 |
|---|:---:|---|
| `css/cell.css` | v1 | `.cell-node.stopped .cell-status-dot` 추가 — 노란색(`#facc15`) dot 스타일 적용<br>`.cell-node.stopped` 테두리 노란색 추가<br>`@keyframes pulse-yellow` 추가 — 2초 주기 느린 점멸 애니메이션 |

### Session 2. 셀 우클릭 메뉴에 Run/Stop 기능 추가
| 파일명 | 버전 | 내용 |
|---|---|---|
| `js/edit.js` | v1 | 노드 우클릭 메뉴에 **이 셀만 Run**, **이 셀부터 Run**, **Stop**(실행 중일 때만 표시) 항목 추가 |
| `js/pipeline.js` | v1 | Run 로직을 `runFromNode(startNodeId, singleOnly)`로 추출 리팩토링. `btnRun` 클릭은 내부적으로 해당 함수를 호출하도록 변경 |
| `modify_manual.md` | v1 | 앵커 추정 절대 금지 규칙 및 올바른/잘못된 앵커 작성 절차 예시 추가 |

### Session 3. LangGraph 기반 셀 실행 파이프라인 검증
| 파일명 | 버전 | 수정 내역 |
|--------|------|-----------|
| `backend.py` | v1 | `AsyncAnthropic`으로 교체, 모든 노드 함수 `async def`로 전환하여 이벤트 루프 블로킹 해소 |
| `backend.py` | v2 | Anthropic/Ollama 모델 분기 (`_is_ollama()`), 지연 초기화로 API Key 없이 서버 시작 가능, `CellState` 및 `RunCellRequest`에 `model` 필드 추가 |
| `backend.py` | v3 | `_stream_run`의 `on_chain_end` 처리에 `isinstance(output, dict)` 타입 가드 추가 (AttributeError 방지) |
| `backend.py` | v4 | `node_finalize`에서 전체 state 필드(`cell_id`, `wrapped_code`, `docstring`, `input_schema`, `output_schema`) 반환 |
| `backend.py` | v5 | `node_human_review`의 `interrupt()` 제거 — 검증 완료 후 wrap 단계로 바로 진행, `langgraph.types.interrupt` import 제거 |
| `backend.py` | v6 | `_stream_run`에서 `result` SSE 방출 시 `output` 대신 `_compiled.get_state(config).values`로 누적 state 직접 읽기 (code·docstring 누락 해소) |
| `css/inspector.css` | v1 | Inspector Config/Result 탭 스타일 추가: `.inspector-tab`, `#inspector-tabs`, `#inspector-result`, `.result-code-block`, `.result-copy-btn`, `.result-section` 등 |
| `index.html` | v1 | Model 선택에 `Custom (Ollama)` 옵션 및 커스텀 입력창 추가 |
| `index.html` | v2 | Inspector에 Config/Result 탭 구조 추가, Result 탭 내 Generated Code·Docstring·Output Schema 섹션 및 Copy 버튼 추가 |
| `js/inspector.js` | v1 | Ollama 커스텀 모델 복원(`openInspector`) 및 저장(`apply-btn`) 로직 추가, `f-model` change 이벤트 전역 등록으로 리스너 누적 버그 수정 |
| `js/inspector.js` | v2 | Config/Result 탭 전환 전역 등록, `openResultTab()` 함수 추가, `openInspector` 내 잔재 코드 정리 |
| `js/inspector.js` | v3 | `_fillResultTab()` 헬퍼 분리, `openResultTabStreaming()` 추가(Run 시작 시 Result 탭 자동 오픈·초기화), `streamResultTab()` 추가(단계별 실시간 업데이트), `openInspector` 클릭 시 항상 Config 탭으로 열어 이전 셀 결과 잔류 버그 수정 |
| `js/pipeline.js` | v1 | Run/Stop 버튼을 백엔드 SSE 스트리밍으로 교체: `runCell()`, `topoSort()`, `getUpstreamSchema()`, `handleSseEvent()`, `showPausedPanel()`, `resumeCell()`, `setNodeStatus()` 구현 |
| `js/pipeline.js` | v2 | `runCell()` body에 `model` 필드 추가, `result` 이벤트 수신 시 `node.result` 저장, 캔버스 클릭 시 `openInspector()` 호출로 통일, 각종 잔재 `}` 제거 |
| `js/pipeline.js` | v3 | `runCell()` 시작 시 `openResultTabStreaming()` 호출, `handleSseEvent()`에서 `stage_start`·`result` 이벤트 시 `streamResultTab()` 호출로 실시간 스트리밍 표시 |

#### Issue in S3
##### 패치 도구 문제 이력

| # | 파일 | 문제 유형 | 원인 | 결과 |
|---|------|----------|------|------|
| 1 | `js/pipeline.js` v1 | 앵커 위치 불일치 (`anchor_end`) | `to: 831`로 범위를 잡으면서 `anchor_end`는 830줄 내용으로 기재 — `to`와 `anchor_end`가 서로 다른 줄을 가리킴 | 수정 후 재출력으로 해결 |
| 2 | `index.html` v1 | 앵커 중복 (`anchor_start`) | `'        <div class="field-group">'`가 ±10줄 범위 내 여러 줄에 존재 — 첫 시도에서 15글자로 지정했고 두 번째도 동일 패턴 반복 | 더 넓은 범위를 보고 유일한 360줄 `<label>Model ...`로 `from`과 `anchor_start` 교체하여 해결 |
| 3 | `js/inspector.js` v1 | 앵커 중복 (`anchor_start`) | `'  document.getElemen'`이 ±10줄 범위 내 여러 줄에 존재 | 해당 줄 전체 텍스트로 앵커를 길게 지정하여 해결 |
| 4 | `js/inspector.js` v1 | 삽입(`from==to`) 방식 오용 | `from=39, to=39` 삽입으로 기존 39줄이 살아남아 Ollama 복원 코드 직후 `node.model`로 덮어씀 — 삽입이 아닌 교체로 했어야 함 | 잔재 코드 별도 패치로 제거 |
| 5 | `js/inspector.js` v1 | 삽입(`from==to`) 방식 오용 | `from=73, to=73` 삽입으로 `apply-btn` 저장 로직도 동일하게 잔재 발생 | 잔재 코드 별도 패치로 제거 |
| 6 | `js/inspector.js` v2 | 앵커 중복 (`anchor_start`) | `'  document.getElemen'`이 또 중복 — 이미 한 번 겪은 동일 실수 반복 | 해당 줄 전체 텍스트로 길게 지정하여 해결 |
| 7 | `js/inspector.js` v2 | 패치 누적으로 잔재 코드 발생 | 이전 삽입 패치들이 중복 적용되면서 51줄에 `});  });  document.getElementById(...)`, 88줄에 `: _sel.value;    : _sel.value; node.model = ...` 형태의 잔재 생성 | 별도 패치로 두 줄 교체하여 제거 |
| 8 | `js/inspector.js` v2 | 앵커 위치 불일치 | 261줄을 262줄로 잘못 기재 | `to: 261`로 수정 후 재출력으로 해결 |
| 9 | `js/pipeline.js` v2 | 잔재 `}` 발생 | `from=1046, to=1047` 패치에서 `anchor_end`로 `/* ─────`를 `replace`에도 포함시켜 원본 `}` 하나가 새 코드 뒤에 붙어 `});}`가 됨 | 별도 패치로 `});}`→`});` 수정 |
| 10 | `js/pipeline.js` v2 | 앵커 중복 (`anchor_start`) | `'}'` 한 글자가 ±10줄 내 여러 줄에 존재 | `anchor_start`를 1045줄 전체 텍스트로 교체하여 해결 |
| 11 | `js/pipeline.js` v2 | 앵커 위치 불일치 | 이전 패치 누적으로 줄 번호가 밀려 1045줄이 실제 1052줄에 위치 | 재업로드 후 확인, 이미 다른 경로로 적용된 것을 확인 |
| 12 | `js/pipeline.js` v2 | 잔재 `}` 재발생 | `});` 패치가 누적 적용되어 `});});}`로 변형 | `bash_tool`로 직접 파일 수정하여 해결 |
| 13 | `js/pipeline.js` v2 | `return st;` 뒤 `}` 누락 | 잔재 제거 과정에서 `if (eventName === 'result')` 블록 닫는 `}`까지 함께 삭제됨 → `catch`가 고아가 되어 `SyntaxError` 발생 | `bash_tool`로 `return st;` 뒤에 `}` 삽입하여 해결 |
| 14 | `js/inspector.js` v3 | 패치 미적용 반복 | 파일 재업로드 없이 패치를 여러 번 시도했으나 실제 적용본이 전달되지 않아 `openResultTab`, 탭 전환 코드가 계속 누락된 상태로 확인됨 | `bash_tool`로 직접 파일을 생성하는 방식으로 전환 |

##### 반복된 근본 원인 패턴

| 패턴 | 설명 |
|------|------|
| **앵커 추정** | `view` 도구로 재확인하지 않고 기억에서 앵커를 작성하여 중복·불일치 발생 |
| **삽입 vs 교체 혼동** | `from==to` 삽입 방식을 써야 할 때와 교체를 써야 할 때를 구분하지 못해 잔재 코드 누적 |
| **범위 산정 오류** | `to` 줄이 `anchor_end`와 다른 줄을 가리키는 모순 — `to`를 계산으로 산출하고 앵커는 다른 줄로 지정 |
| **누적 패치 후 줄 번호 drift** | 이전 패치의 delta를 추적하지 않아 줄 번호가 밀린 상태로 다음 패치 출력 |
| **패치 적용 확인 부재** | 패치 적용 후 파일 재업로드 없이 이전 버전 기준으로 다음 패치를 출력하여 이중 적용 및 잔재 발생 |

# TODO
- 셀을 모두 그렸다고 치면 아래와 같이 작업이 Run 되어야 함.
    1) 시작 셀이 각 셀에게 필요한 라이브러리와 버전을 명시하라고 요구함.
    2) 시작 셀에서 라이브러리를 취합하여 버전을 통일하도록 하고, 의존성 및 환경설정 문제를 미리 방지함.
    3) 주어진 환경 및 버전을 각 셀의 프롬프트에 제시함.
    4) 이후 순서대로 Run 시작.
    5) 마지막에 output 셀에서 코드 조립.
- 사용자의 관점에서 셀 설계 배치방법을 정의할 것.
    - 이 앱의 특징 : 데이터의 흐름에 따라 어떻게 가공되는지를 보여줌.
    - 사용자 입장에서 직관적일까? 아이디어는 좋은데, 이해하기 어렵다면 써먹기는 힘들 것.
- OUTPUT CELL은 J(oin, 연결) 모드로 진입하지 않게 할 것.


