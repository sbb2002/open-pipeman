# HANDOFF — Visual AI Pipeline Builder

> 마지막 업데이트: 2026-05-27

---

## Goal

`feature_spec.html`의 미구현 항목들을 우선순위 순서대로 구현한다.  
현재는 **[1순위] #2 `n(INPUT)==n(OUTPUT)` 검증**, **#3 파이프라인 자동 인식**부터 시작할 차례다.

---

## 프로젝트 구조 요약

- **프로젝트 루트:** `C:\Users\user\Documents\myprojects\open-pipeman\demo_langgra3`
- **핵심 참조 문서:** `docs/modify_manual.md` (코드 수정 절차), `docs/structure.md` (파일 구조), `docs/specs.md` (명세)
- **Wiki 설계 문서:** `docs/wiki/` — 복잡도 높은 항목별 구현 설계 문서 모음

---

## Current Progress (이번 세션 완료 사항)

### docs/ 구조 정리
- `docs/` 폴더를 LLM 참조 파일 / 아카이브로 분리 완료
- `docs/archive/` 생성: `phrases.md`(deprecated), `patch_note/html/`, `patch_note/ref/*.html` 이동
- `docs/patch_note/md/*.md` → `docs/patch_note/` 루트로 승격
- `docs/modify_manual.md` 내 `docs/` 금지 문구 → `docs/archive/`로 좁혀 수정
- 빈 폴더 3개(`patch_note/html/`, `patch_note/md/`, `patch_note/ref/`) — **수동 삭제 필요** (filesystem MCP로 빈 폴더 삭제 불가)

### Wiki 문서 작성 (docs/wiki/)
실제 코드(`inspector.js`, `runner.js`, `canvas.js`, `state.js`)를 읽고 현재 구현 상태를 분석하여 아래 문서 작성 완료:

| 파일 | 항목 |
|---|---|
| `index.md` | 전체 인덱스 + 의존 관계 |
| `pipeline-validation.md` | #2 n(INPUT)==n(OUTPUT), #3 파이프라인 자동 인식 |
| `branch-reference-cell.md` | #4 분기 셀, #5 참조 셀, #6 점선 엣지 |
| `broadcasting-aggregating.md` | #7 Broadcasting/Aggregating |
| `project-config-skill-md.md` | #8 Project Config 트레이 |
| `export.md` | #9 Export (JSON/zip) |

---

## 미구현 항목 전체 목록 (feature_spec.html 기준)

| # | 항목 | 순위 | 복잡도 | 상태 |
|---|---|---|---|---|
| 1 | JSON Schema I/O assertion UI | 1 | ★★★ | ✅ 구현완료 (저번 세션) |
| 2 | n(INPUT)==n(OUTPUT) 검증 | 1 | ★★ | ⬜ 미구현 ← **다음 작업** |
| 3 | 파이프라인 자동 인식 | 1 | ★★ | ⬜ 미구현 ← **다음 작업** |
| 4 | 분기 셀 (Branch Cell) | 2 | ★★★ | ⬜ 미구현 |
| 5 | 참조 셀 (Reference Cell) | 2 | ★★ | ⬜ 미구현 |
| 6 | 점선 엣지 | 2 | ★ | ⬜ 미구현 |
| 7 | Broadcasting/Aggregating | 2 | ★★★ | ⬜ 미구현 |
| 8 | Project Config 트레이 (Skill.md) | 2 | ★★ | ⬜ 미구현 |
| 9 | Export (JSON / file+zip) | 3 | ★★ | ⬜ 미구현 |
| 10 | 셀 미니 프로그레스바 (버그 보류) | 4 | ★ | 🔧 부분구현 |
| 11 | 온보딩 오버레이 | 4 | ★ | ⬜ 미구현 |
| 12 | 셀 템플릿 선택 | 4 | ★ | ⬜ 미구현 |
| 13 | Inspector 평어 레이블 | 4 | ★ | ⬜ 미구현 |
| 14 | 실행 결과 이미지·바이너리 렌더링 | 5 | ★★ | 🔧 부분구현 |
| 15 | 멀티모달 프롬프트 입력 | 5 | ★★ | ⬜ 미구현 |

---

## Next Steps

### 즉시 시작: #3 → #2 순서로 진행

**#3 파이프라인 자동 인식** (`runner.js`에 신규 함수 추가):
```
detectPipelines(nodes, edges) 구현
- 방향 무시 BFS로 Connected Component 탐색
- 반환: Pipeline[] = { nodes: Node[], edges: Edge[] }
- 고립 노드(엣지 없음)는 별도 처리
```

**#2 n(INPUT)==n(OUTPUT) 검증** (`inspector.js` `validatePipeline()` 확장):
```
detectPipelines() 호출 후 각 파이프라인에 대해:
- inputCount vs outputCount 비교
- 불균형 시 에러 메시지: "파이프라인 N: INPUT(x) ≠ OUTPUT(y)"
- 고립 노드는 경고(warning) 수준
```

### 설계 문서 참조
- 상세 설계: `docs/wiki/pipeline-validation.md`
- 수정 절차: `docs/modify_manual.md`

---

## 코드 수정 시 주의사항

- **파일 편집 전 반드시 사용자 허락** (`modify_manual.md` 절대 원칙)
- 수정 방법: 변경 1~10곳 → `str.replace` 스크립트(`bash_tool`), 30% 이상 변경 → `filesystem:write_file` 통파일
- `docs/archive/` 폴더는 읽지 말 것 (명시적 요청 시만)
- `topoSort()` 시그니처 변경 시 `hitl.js`의 `state.pendingRunOrder` 사용 부분도 함께 수정 필요

---

## 참고: 현재 구현된 핵심 함수 위치

| 함수 | 파일 | 역할 |
|---|---|---|
| `validatePipeline()` | `inspector.js` | 파이프라인 유효성 검사 (확장 대상) |
| `topoSort()` | `runner.js` | DAG 위상 정렬 (레이어화 예정) |
| `getUpstreamSchema()` | `runner.js` | upstream 단일 schema 수집 (다중 지원 예정) |
| `detectPipelines()` | `runner.js` | **신규 추가 예정** |
| `createNode()` | `canvas.js` | 노드 생성 (branch/reference 타입 추가 예정) |
| `drawEdges()` | `canvas.js` | 엣지 렌더링 (점선 지원 예정) |
| `storeGet/Set/Delete` | `store.js` | localStorage CRUD (Skill.md 저장에 활용 예정) |
