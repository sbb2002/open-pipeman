# 분기 셀 (Branch Cell)

> **관련 구현 항목:** [2순위] #4, #5, #6  
> **담당 파일:** `canvas.js`, `cell.css`, `runner.js` (`topoSort()`)  
> **선행 조건:** 파이프라인 자동 인식(`detectPipelines()`) 구현 완료 권장

---

## 1. 목표 요약

| # | 항목 | 한 줄 설명 |
|---|---|---|
| 4 | 분기 셀 (Branch Cell) | JSON Schema 필드 타입/값 기반으로 경로를 분기하는 마름모(◇) 형태의 셀 |
| 5 | 참조 셀 (Reference Cell) | CSS·공통 유틸 등 import 역할의 특수 셀. 점선 엣지로 연결 |
| 6 | 점선 엣지 | 참조 셀 전용 엣지. 일반 엣지와 시각적으로 구분 |

세 항목은 **함께 묶어 구현**하는 것이 자연스럽다. 점선 엣지(#6)는 참조 셀(#5)에 종속되고, 참조 셀은 분기 셀(#4)과 같은 "특수 셀" 카테고리에 속한다.

---

## 2. 현재 구현 상태

### 셀 타입 — `canvas.js` `createNode()`

현재 허용 타입: `'cell'` | `'input'` | `'output'`

```js
const labels = { cell: 'CELL', input: 'INPUT', output: 'OUTPUT' };
```

- `'branch'`, `'reference'` 타입 없음
- `input`/`output`은 각 1개 제한 로직이 있음 → 분기·참조 셀은 다수 배치 가능해야 하므로 이 분기 로직 수정 필요

### 엣지 렌더링 — `canvas.js` `drawEdges()`

현재 모든 엣지는 단일 스타일(실선, `#7ee8a2`)로 렌더링됨:

```js
// 항상 accent 색상(연결됨)으로 표시 — 문자열 비교 제거
const color = '#7ee8a2';
ctx.setLineDash([]);  // 항상 실선
```

- `setLineDash([])` 고정 → 점선 불가
- 엣지 객체(`state.edges`)에 타입 구분 필드 없음: `{ from, to, valid }`

### 위상 정렬 — `runner.js` `topoSort()`

현재 `topoSort()`는 단순 Kahn's 알고리즘으로 선형 실행 순서만 반환:

```js
const order = [];  // 단일 배열
```

- 분기(1:N 출력) 처리 로직 없음
- 분기 조건(필드 타입/값 비교) 평가 로직 없음
- 분기 결과에 따라 특정 경로만 실행하는 선택 실행 없음

### 노드 렌더링 — `canvas.js` `renderNode()`

현재 모든 노드는 직사각형 `div.cell-node`로 렌더링:

```js
el.className = 'cell-node pending';
```

- 마름모 형태를 위한 CSS 클래스 없음
- `cell.css`에 `.branch-node` 스타일 없음

---

## 3. 구현 설계

### 3-1. 분기 셀 데이터 구조

`createNode()`에서 생성하는 노드 객체에 분기 조건 필드 추가:

```js
// type === 'branch'일 때 추가 필드
{
  id, type: 'branch',
  name: 'Branch N',
  x, y,
  branchConditions: [
    // { field: 'type', op: '==', value: 'image', targetEdgeId: null }
    // targetEdgeId는 연결 시 edge.id와 매핑
  ],
  status: 'pending',
}
```

### 3-2. 엣지 구조 확장

현재: `{ from, to, valid }`  
변경: `{ from, to, valid, edgeType }` — `edgeType: 'normal' | 'reference' | 'branch-true' | 'branch-false'`

```js
// 엣지 생성 시 기본값
const edge = { from, to, valid: true, edgeType: 'normal' };
```

### 3-3. 점선 엣지 렌더링 — `drawEdges()` 수정

```js
// edgeType에 따라 lineDash 분기
if (edge.edgeType === 'reference') {
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#7ee8a2';
} else {
  ctx.setLineDash([]);
  ctx.strokeStyle = '#7ee8a2';
}
```

### 3-4. 마름모 형태 렌더링 — `renderNode()` 수정

분기 셀은 CSS `clip-path` 또는 `transform: rotate(45deg)`로 마름모 형태 구현:

```css
/* cell.css 추가 */
.cell-node.branch {
  clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  width: 120px;
  height: 120px;
  background: var(--surface2);
  border: 2px solid var(--warn);
}
```

> **주의:** `clip-path` 사용 시 내부 텍스트 레이아웃이 깨질 수 있음. `transform: rotate(45deg)` + 내부 역회전 방식이 더 안전할 수 있음. 구현 시 선택.

### 3-5. `topoSort()` 확장 — 분기 조건 평가

분기 셀 실행 시점에 upstream `outputSchema`의 특정 필드 값을 평가하여 활성화할 경로를 결정:

```
runFromNode() 실행 중 분기 셀 도달 시:
  1. upstream outputSchema에서 branchConditions[i].field 값 읽기
  2. 조건 평가 (==, !=, >, < 등)
  3. 조건 일치하는 branch 엣지로 연결된 노드만 runOrder에 포함
  4. 나머지 경로 노드는 status = 'skipped' 처리
```

분기 조건 평가는 백엔드 없이 **프론트에서 직접 수행** (LLM 불필요).

### 3-6. 트레이 / 우클릭 메뉴 추가

`index.html`의 팔레트 트레이에 Branch, Reference 아이템 추가:

```html
<div class="palette-item" draggable="true" data-type="branch">◇ Branch</div>
<div class="palette-item" draggable="true" data-type="reference">⬡ Reference</div>
```

우클릭 컨텍스트 메뉴(`edit.js`)에도 동일하게 추가.

---

## 4. 수정 범위 및 파일별 작업

### `canvas.js`
- `createNode()`: `'branch'`, `'reference'` 타입 처리 추가 (다수 배치 허용)
- `renderNode()`: 타입별 DOM 구조 분기 — 분기 셀은 마름모 레이아웃
- `drawEdges()`: `edge.edgeType` 기반 실선/점선 분기
- `finalizeEdge()`: 엣지 생성 시 `edgeType` 필드 설정 로직 추가

### `cell.css`
- `.cell-node.branch` 마름모 스타일 추가
- `.cell-node.reference` 참조 셀 스타일 추가 (점선 테두리 등)

### `runner.js`
- `runFromNode()`: 분기 셀 도달 시 조건 평가 → 활성 경로만 실행
- `topoSort()`: 분기 셀 이후 노드를 조건부로 포함/제외하는 로직 추가

### `inspector.js`
- `validatePipeline()`: 분기·참조 셀을 INPUT/OUTPUT 카운트에서 제외
- `openInspector()`: 분기 셀 선택 시 조건 편집 UI 표시 (branchConditions 편집)

### `state.js`
- `state.edges` 주석의 타입 정의에 `edgeType` 필드 추가

---

## 5. 엣지 케이스

| 케이스 | 예상 동작 |
|---|---|
| 분기 셀에 출력 엣지가 1개만 연결됨 | 경고 — 분기 셀은 최소 2개 출력이 필요 |
| 분기 조건이 모두 불일치 | 모든 경로 skipped, 파이프라인 종료 |
| 분기 조건 필드가 upstream schema에 없음 | 에러 표시, 실행 중단 |
| 참조 셀이 OUTPUT에 연결됨 | 허용 안 함 — 참조 셀은 일반 셀에만 연결 가능 |

---

## 6. 이 기능에 의존하는 후속 항목

- **Broadcasting/Aggregating (#7):** 분기 셀이 N:1 집계의 전제
- **Export (#9):** 분기 경로를 포함한 코드 생성 시 조건문 삽입 필요
- **파이프라인 자동 인식:** `detectPipelines()`에서 분기·참조 셀 카운트 제외 처리 필요
