# 파이프라인 검증: n(INPUT)==n(OUTPUT) & 자동 인식

> **관련 구현 항목:** [1순위] #2, #3  
> **담당 파일:** `inspector.js`, `runner.js`  
> **선행 조건:** JSON Schema I/O assertion UI (#1) 구현 완료 상태에서 진행

---

## 1. 목표 요약

| # | 항목 | 한 줄 설명 |
|---|---|---|
| 2 | n(INPUT)==n(OUTPUT) 검증 | 캔버스 위의 모든 독립 파이프라인에 대해 INPUT 셀 수와 OUTPUT 셀 수가 일치하는지 검사 |
| 3 | 파이프라인 자동 인식 | 연결 경로 분석으로 독립된 파이프라인 집합(Connected Component)을 자동으로 구분 |

두 항목은 **파이프라인 자동 인식(#3)이 선행**되어야 검증(#2)이 의미를 갖는다. 순서: 3 → 2.

---

## 2. 현재 구현 상태

### `validatePipeline()` — `inspector.js`

현재 `validatePipeline()`은 아래만 검사한다:

```
- 모든 노드에 name이 있는가
- 일반 셀(cell 타입)에 model, prompt가 있는가
```

**파이프라인 토폴로지(연결 구조) 검사는 전혀 없음.** 즉:
- 캔버스에 INPUT만 있고 OUTPUT이 없어도 `canRun = true`가 될 수 있음
- 서로 단절된 두 파이프라인이 있어도 하나의 파이프라인으로 취급됨

### `topoSort()` — `runner.js`

Kahn's 알고리즘으로 DAG 위상 정렬을 수행하지만 **파이프라인 분리 개념이 없음**:
- `state.nodes` 전체를 단일 그래프로 취급
- 진입차수 0인 노드를 모두 시작점으로 삼음 → 단절된 파이프라인도 함께 실행됨
- 각 독립 파이프라인을 구분하여 순서를 제어하는 로직 없음

### `state` 객체 — `state.js`

파이프라인 단위의 상태를 추적하는 필드 없음. 현재 구조:
```js
state.nodes  // 전체 노드 배열 (타입 무관)
state.edges  // 전체 엣지 배열
```

파이프라인 집합을 식별하는 `state.pipelines` 같은 필드가 존재하지 않음.

---

## 3. 구현 설계

### 3-1. 파이프라인 자동 인식 (Connected Components 분리)

**어디에 구현:** `runner.js` 또는 `inspector.js` 공용 유틸 함수로 추출

**알고리즘:** 방향 무시 BFS/DFS로 Connected Component 탐색

```
함수: detectPipelines(nodes, edges)
입력: state.nodes, state.edges
출력: Pipeline[] — 각 파이프라인은 { nodes: Node[], edges: Edge[] }

절차:
1. 모든 노드를 unvisited로 마킹
2. unvisited 노드에서 BFS 시작 (엣지 방향 무시)
3. 연결된 노드 집합을 하나의 파이프라인으로 묶음
4. 연결되지 않은 노드 그룹마다 반복 → Pipeline[] 반환
```

**제외 대상 (카운트에서 제외):**
- 분기 셀(Branch Cell): 미구현이므로 현재는 고려 불필요
- 참조 셀(Reference Cell): 미구현이므로 현재는 고려 불필요
- 고립 노드(엣지가 하나도 없는 셀): 파이프라인으로 카운트하지 않음 — 별도 경고 처리

### 3-2. n(INPUT)==n(OUTPUT) 검증

**어디에 구현:** 기존 `validatePipeline()` 내부에 추가 블록으로 삽입

**검사 로직:**

```
detectPipelines() 호출 → 파이프라인 배열 획득

각 파이프라인 p에 대해:
  inputCount  = p.nodes.filter(n => n.type === 'input').length
  outputCount = p.nodes.filter(n => n.type === 'output').length

  if inputCount === 0 → 에러: "파이프라인에 INPUT 셀이 없습니다"
  if outputCount === 0 → 에러: "파이프라인에 OUTPUT 셀이 없습니다"
  if inputCount !== outputCount → 에러: "INPUT(n)과 OUTPUT(m) 수가 일치하지 않습니다"
```

**고립 노드 처리:**
- 엣지 없이 혼자 있는 노드 → "연결되지 않은 셀이 있습니다" 경고 (에러가 아닌 warning 수준)
- `canRun` 차단 여부는 선택 사항 (UX 판단 필요)

---

## 4. 수정 범위 및 파일별 작업

### `runner.js`
- `detectPipelines(nodes, edges)` 함수 추가 (신규)
- `topoSort()` 수정: 단일 파이프라인 기준으로 정렬 가능하도록 파이프라인 노드 집합을 파라미터로 받을 수 있게 시그니처 확장 검토

### `inspector.js`
- `validatePipeline()` 내부에 파이프라인 구조 검사 블록 추가
- 에러 메시지 포맷: `"파이프라인 1: INPUT(2) ≠ OUTPUT(1)"` 형태로 파이프라인 번호 포함

### `state.js`
- 필요 시 `state.pipelines` 캐시 필드 추가 (매번 재계산 vs 캐싱 트레이드오프 검토)
- 노드/엣지 변경 이벤트마다 캐시 무효화 필요 → 복잡도 상승. **초기엔 캐싱 없이 매 호출마다 재계산 권장**

---

## 5. 엣지 케이스

| 케이스 | 예상 동작 |
|---|---|
| 노드 0개 | `validatePipeline()` 기존 로직("No cells")으로 처리, 파이프라인 검사 스킵 |
| 고립 노드(엣지 없음) 1개 | 경고 표시, `canRun` 차단은 선택적 |
| INPUT만 있고 OUTPUT 없음 | 에러: "OUTPUT 셀이 없습니다" |
| INPUT 2개, OUTPUT 1개 | 에러: "INPUT(2) ≠ OUTPUT(1)" |
| 독립 파이프라인 2개, 각각 I/O 균형 | 정상: 각각 독립적으로 검증 통과 |
| 독립 파이프라인 2개, 하나만 불균형 | 에러: 불균형 파이프라인만 에러 표시 |
| 모든 노드가 연결된 단일 파이프라인 | 기존 동작과 동일 |

---

## 6. 구현 순서 (권장)

```
1. runner.js — detectPipelines() 구현 및 단독 테스트
     → 콘솔에서 state.nodes/edges로 직접 호출하여 결과 확인
2. inspector.js — validatePipeline()에 파이프라인 구조 검사 블록 삽입
     → 에러 메시지가 error-panel에 올바르게 표시되는지 확인
3. (선택) runner.js — runFromNode()에서 파이프라인 단위 실행 분리
     → 현재는 전체 노드 대상이므로, 특정 파이프라인만 실행하는 경로 추가
```

---

## 7. 이 기능에 의존하는 후속 항목

- **분기 셀(#4):** 분기 셀이 추가되면 `detectPipelines()`에서 분기 셀을 카운트 제외 처리해야 함
- **Export(#9):** 파이프라인 단위로 코드를 묶어서 내보내려면 `detectPipelines()` 결과가 필요
- **Broadcasting/Aggregating(#7):** 다중 INPUT→단일 OUTPUT 패턴 처리 시 n==n 규칙 재검토 필요할 수 있음
