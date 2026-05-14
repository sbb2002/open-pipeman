`style.css` 1703줄을 6개로 분리했습니다.

| 파일 | 줄 수 | 내용 |
|---|---|---|
| `base.css` | 50 | CSS 변수, reset, 전역 폰트, 스크롤바 |
| `layout.css` | 392 | 사이드바, 헤더, 캔버스, 상태바, 줌 컨트롤 |
| `cell.css` | 181 | 셀 노드, 멀티선택, 고스트, I/O 컬러, Apply 애니메이션 |
| `inspector.css` | 237 | CELL CONFIG 패널, Memo 말풍선 |
| `overlays.css` | 219 | 경고 모달, 컨텍스트 메뉴, 확인 다이얼로그 |
| `settings.css` | 619 | 설정 팝업 전체 (탭, 폰트, 컬러피커, 무지개 버튼) |

`index.html`이 `css/` 폴더의 6개 파일을 순서대로 로드하도록 업데이트됐습니다.

의존성 순서를 정확히 파악한 뒤 분리합니다.구조 완전 파악. 이제 분리합니다.이제 실제 브라우저에서 작동하는지 확인하기 위해 함수 참조 교차 검증을 합니다.의존성 순환이 있습니다. JS 파일은 선언 시점이 아닌 **호출 시점**에 함수를 찾으므로 — 이벤트 핸들러와 함수 내부 호출은 실행 시에 해석됩니다. 즉 실제 브라우저에서는 모든 파일이 로드된 후 호출되므로 문제가 없습니다. `resizeCanvas()`만 즉시 실행되기 때문에 `drawEdges`보다 먼저 있어야 합니다.이제 전체 검증을 합니다.모두 통과. 이제 outputs로 복사합니다.`app.js` 2215줄을 7개로 분리했습니다. 모든 파일 문법 검증(`node --check`) 통과, 22개 핵심 함수 전부 존재 확인했습니다.

| 파일 | 줄 수 | 내용 |
|---|---|---|
| `state.js` | 29 | 전역 state 객체, DOM 참조 상수 |
| `ui.js` | 108 | applyInputCopy, finalizeEdge, showModal, showConfirm, memo tooltip |
| `canvas.js` | 433 | 셀 생성/렌더, 드래그, 연결, edge 그리기, ghost, resizeCanvas |
| `inspector.js` | 194 | CELL CONFIG 패널 열기/닫기/저장, validatePipeline |
| `edit.js` | 728 | 컨텍스트 메뉴, 정렬, Auto Layout, zoom, undo/redo, 키보드 단축키 |
| `settings.js` | 502 | 설정 팝업, 테마/패턴/컬러/폰트, 커스텀 컬러피커 |
| `pipeline.js` | 192 | Run/Stop, Save/Load, 프로젝트 초기화, initIOCells |

로드 순서: `state → ui → canvas → inspector → edit → settings → pipeline`