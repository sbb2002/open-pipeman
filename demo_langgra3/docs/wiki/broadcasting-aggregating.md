# Broadcasting / Aggregating 전략

> **관련 구현 항목:** [2순위] #7  
> **담당 파일:** `canvas.js`, `runner.js`  
> **선행 조건:** 분기 셀(#4) 구현 완료, `detectPipelines()` 구현 완료

---

## 1. 목표 요약

하나의 셀 출력을 여러 셀로 분사(Broadcasting, 1:N)하고, 여러 셀의 출력을 하나로 수집(Aggregating, N:1)할 때, LLM 코드 생성 시 **병렬 실행 패턴(`asyncio.gather` / `Promise.all`)을 자동 적용**한다.

---

## 2. 현재 구현 상태

### 엣지 연결 — `canvas.js`

현재 1:N 연결(한 노드에서 여러 노드로 출력)은 **이미 허용**됨:

```js
// state.edges: 동일 from을 가진 엣지 여럿 존재 가능
state.edges = state.edges.filter(e => !(e.from === from && e.to === to));
// 중복 제거만 할 뿐 1:N 자체를 막지 않음
```

N:1 연결(여러 노드에서 하나로 입력)도 **이미 허용**됨 — 단, upstream schema 동기화는 마지막으로 연결된 upstream 기준으로 덮어씌워짐 (버그 가능성 있음).

### 실행 엔진 — `runner.js` `runFromNode()`

현재 실행은 `topoSort()` 결과를 **순차적으로** 실행:

```js
for (const nodeId of runOrder) {
  const result = await runCell(node, upstreamSchema);
  // 항상 순차 — 병렬 실행 없음
}
```

- 1:N 구조에서 N개 노드를 병렬로 실행하지 않음
- N:1 구조에서 N개 결과를 합산하여 하나의 downstream으로 전달하는 로직 없음

### upstream schema 수집 — `runner.js` `getUpstreamSchema()`

```js
function getUpstreamSchema(nodeId) {
  const edge = state.edges.find(e => e.to === nodeId);  // 첫 번째 upstream만
  if (!edge) return {};
  const upstream = state.nodes.find(n => n.id === edge.from);
  return (upstream && upstream.outputSchema) ? upstream.outputSchema : {};
}
```

- `find()`로 **첫 번째 upstream만** 반환 → N:1 구조에서 나머지 upstream 무시됨
- 다중 upstream 지원 없음

---

## 3. 구현 설계

### 3-1. 구조 탐지: Broadcasting vs Aggregating

`detectPipelines()`와 별개로, 각 노드의 팬아웃/팬인 수를 분석하는 유틸 추가:

```
함수: analyzeTopology(nodes, edges)
출력: {
  broadcasting: Set<nodeId>,   // 출력 엣지가 2개 이상인 노드 (1:N 소스)
  aggregating:  Set<nodeId>,   // 입력 엣지가 2개 이상인 노드 (N:1 수집처)
}
```

### 3-2. 병렬 실행 — `runFromNode()` 수정

`topoSort()` 결과를 단순 배열이 아닌 **실행 레이어(wave)** 단위로 그룹화:

```
레이어 예시:
  Layer 0: [INPUT]          → 순차 실행
  Layer 1: [CellA, CellB]   → 병렬 실행 (Broadcasting 결과)
  Layer 2: [CellC]          → CellA+CellB 완료 후 실행 (Aggregating)
  Layer 3: [OUTPUT]         → 순차 실행
```

구현 방식: Kahn's 알고리즘 변형 — 동일 레이어(진입차수가 같은 시점에 해방되는 노드들)를 배열로 묶음:

```js
// 기존: order = [id1, id2, id3, ...]
// 변경: layers = [[id1], [id2, id3], [id4], ...]

async function runLayers(layers) {
  for (const layer of layers) {
    if (layer.length === 1) {
      await runCell(...);           // 단일 노드 → 순차
    } else {
      await Promise.all(layer.map(id => runCell(...)));  // 다중 노드 → 병렬
    }
  }
}
```

### 3-3. upstream schema 다중 수집 — `getUpstreamSchema()` 수정

N:1 구조에서 여러 upstream의 outputSchema를 병합:

```js
function getUpstreamSchemas(nodeId) {
  const upstreamEdges = state.edges.filter(e => e.to === nodeId);
  if (upstreamEdges.length === 0) return {};
  if (upstreamEdges.length === 1) {
    // 기존 동작 유지
    const up = state.nodes.find(n => n.id === upstreamEdges[0].from);
    return up?.outputSchema || {};
  }
  // N:1: 여러 upstream schema를 배열로 묶어 전달
  return upstreamEdges.map(e => {
    const up = state.nodes.find(n => n.id === e.from);
    return up?.outputSchema || {};
  });
  // 백엔드의 upstream_schema 필드가 배열을 수용해야 함 → api.py, nodes.py 수정 필요
}
```

### 3-4. LLM 코드 생성 시 병렬 패턴 자동 주입

Broadcasting/Aggregating 구조가 감지된 셀에는 백엔드 코드 생성 시 시스템 프롬프트에 힌트 추가:

```
# Broadcasting 소스 셀
"이 함수의 출력은 여러 병렬 프로세스의 입력으로 사용됩니다. 출력 데이터가 직렬화 가능한지 확인하세요."

# Aggregating 수집 셀
"이 함수는 여러 병렬 프로세스의 결과를 입력으로 받습니다. upstream_schema는 배열입니다.
asyncio.gather 또는 Promise.all 패턴으로 병렬 처리된 결과를 수집하여 단일 출력으로 변환하세요."
```

이 힌트는 `runner.js`에서 `runCell()` 호출 시 `body`에 추가 필드로 전달:

```js
body = JSON.stringify({
  ...기존 필드,
  is_broadcast_source: true,  // 또는
  is_aggregator: true,
  upstream_schemas: [...],    // N:1인 경우 배열
});
```

백엔드(`nodes.py`, `api.py`)에서 해당 필드를 받아 프롬프트에 반영 필요.

---

## 4. 수정 범위 및 파일별 작업

### `runner.js`
- `topoSort()` 반환 타입 변경: `id[]` → `id[][]` (레이어 배열)
- `runFromNode()`: 레이어 단위 병렬 실행 로직 추가
- `getUpstreamSchema()` → `getUpstreamSchemas()`: 다중 upstream 지원
- `runCell()` body에 `is_broadcast_source`, `is_aggregator`, `upstream_schemas` 필드 추가

### `canvas.js`
- `_attemptConnect()`: N:1 연결 시 다중 upstream schema 충돌 처리 (현재는 마지막 upstream이 덮어씌움 — 명시적 경고 또는 merge 로직 필요)

### `api.py` / `nodes.py` (백엔드)
- `RunCellRequest`에 `is_aggregator`, `upstream_schemas` 필드 추가
- `inject_schema` 또는 `generate` 노드에서 해당 필드 기반으로 프롬프트 힌트 삽입

---

## 5. 엣지 케이스

| 케이스 | 예상 동작 |
|---|---|
| Broadcasting 후 일부 병렬 셀 실패 | 실패 셀 이후 경로 중단, 나머지 경로는 계속 실행 |
| Aggregating 셀의 upstream 중 일부가 skipped | skipped upstream schema는 집계에서 제외, 나머지로만 실행 |
| 동일 셀이 Broadcasting이자 Aggregating | 허용 — 레이어 분석으로 자동 처리 |
| N:1 upstream schema 키 충돌 | 경고 표시. merge 전략(first-win / last-win / union) 선택 필요 |

---

## 6. `topoSort()` 반환 타입 변경의 파급 효과

`topoSort()` 반환값이 `id[]` → `id[][]`로 바뀌면 아래 호출부 전부 수정 필요:

| 호출 위치 | 현재 사용 방식 | 수정 방향 |
|---|---|---|
| `runFromNode()` | `for (const nodeId of runOrder)` | `for (const layer of runOrder) → for (const nodeId of layer)` |
| `hitl.js` `resumeCell()` | `state.pendingRunOrder.slice(...)` | 레이어 배열 기준으로 슬라이스 |

**주의:** `topoSort()` 시그니처 변경은 `hitl.js`의 재개 로직에도 영향을 미침. 변경 전 `hitl.js`의 `state.pendingRunOrder` 사용 방식을 확인할 것.
