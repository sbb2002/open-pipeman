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
