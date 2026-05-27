# Export — JSON 파이프라인 & file 포함 파이프라인

> **관련 구현 항목:** [3순위] #9  
> **담당 파일:** `runner.js`, `api.py`  
> **선행 조건:** 파이프라인 자동 인식(`detectPipelines()`) 구현 완료

---

## 1. 목표 요약

| 케이스 | 조건 | 출력 |
|---|---|---|
| JSON Export | OUTPUT 셀의 outputContract에 `file` 타입 없음 | 단일 Python 실행 스크립트 (`.py`) |
| file Export | OUTPUT 셀의 outputContract에 `file` 타입 포함 | zip 묶음 (스크립트 + 관련 파일) |

---

## 2. 현재 구현 상태

### `runner.js`

Export 관련 함수 없음. `runFromNode()`는 실행만 담당하고 코드 수집·조립 로직 없음.

### 셀 실행 결과 — `node.result`

셀 실행 후 `node.result`에 아래가 저장됨:

```js
node.result = {
  code:          '...',   // LLM이 생성한 Python 코드
  docstring:     '...',
  input_schema:  {},
  output_schema: {},
  assertions:    [],
}
```

**Export의 핵심 재료는 이미 `node.result.code`에 있음.**  
단, 모든 셀이 실행 완료된 상태여야 수집 가능.

### 파이프라인 순서 — `topoSort()`

실행 순서(위상 정렬) 결과를 그대로 코드 조립 순서로 사용 가능.

---

## 3. 구현 설계

### 3-1. Export 타입 판별

```js
function getExportType(pipeline) {
  const outputNodes = pipeline.nodes.filter(n => n.type === 'output');
  const hasFileOutput = outputNodes.some(n => {
    const props = n.outputContract?.properties || {};
    return Object.values(props).some(def => def.type === 'file');
  });
  return hasFileOutput ? 'zip' : 'script';
}
```

### 3-2. 스크립트 조립 — JSON Export

`topoSort()` 순서대로 각 셀의 `node.result.code`를 연결:

```
조립 구조:
  1. 헤더 주석 (파이프라인 이름, 생성일)
  2. 공통 import (각 셀 코드에서 import 구문 추출·중복 제거)
  3. 셀별 함수 정의 (topoSort 순서)
  4. main() 함수: 셀 실행 순서에 따라 함수 호출 체인 조립
  5. if __name__ == '__main__': main() 진입점
```

```python
# 조립 예시
# === Cell 1: IMAGE_LOADER ===
def cell_1_image_loader(file_path: str) -> dict:
    ...

# === Cell 2: RESIZE ===
def cell_2_resize(image_path: str, width: int) -> dict:
    ...

def main():
    result_1 = cell_1_image_loader(input_file_path)
    result_2 = cell_2_resize(**result_1)
    return result_2
```

### 3-3. zip 조립 — file Export

```
zip 구조:
  pipeline_export.zip
  ├── main.py          ← 조립된 실행 스크립트
  └── files/           ← OUTPUT에 file 타입이 있을 때
      └── (placeholder or 실제 파일)
```

zip 생성: 브라우저에서 `JSZip` 라이브러리 사용 (CDN 로드 또는 번들). 현재 프로젝트에 미포함 → `index.html`에 추가 필요.

### 3-4. 다운로드 트리거

```js
function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
```

### 3-5. Export 진입점

- **헤더의 Export 버튼** (현재 없음 → `index.html`에 추가)
- 또는 **우클릭 컨텍스트 메뉴** → "Export Pipeline"

실행되지 않은 셀(`node.result`가 null)이 있으면:

```
경고: "일부 셀이 실행되지 않았습니다. 실행 후 Export하면 더 정확한 코드를 얻을 수 있습니다."
[실행 후 Export] [그냥 Export (스켈레톤 코드)]
```

미실행 셀은 함수 시그니처만 생성하고 본문은 `pass` 또는 `raise NotImplementedError`.

---

## 4. 수정 범위 및 파일별 작업

### `runner.js`
- `exportPipeline()` 함수 추가 (신규)
- `collectPipelineCode(pipeline)`: 셀 코드 수집 + 조립
- `getExportType(pipeline)`: 타입 판별
- `triggerDownload()`: 다운로드 헬퍼

### `index.html`
- Export 버튼 추가 (헤더 또는 사이드바)
- JSZip CDN 추가 (zip Export 필요 시)

### `api.py` (선택)
- 서버 사이드 Export 엔드포인트 (`POST /pipeline/export`) 추가 검토
- 브라우저 사이드만으로 충분하다면 불필요

---

## 5. 엣지 케이스

| 케이스 | 예상 동작 |
|---|---|
| 미실행 셀 포함 | 경고 후 스켈레톤 코드로 Export |
| 다중 독립 파이프라인 | 파이프라인별로 별도 파일 생성, zip으로 묶음 |
| Broadcasting 구조 포함 | `asyncio.gather` 패턴으로 main() 조립 |
| 분기 셀 포함 | 조건문(`if/elif/else`) 삽입 |
| 셀 코드에 절대 경로 포함 | 경고: "이식 불가능한 경로가 포함될 수 있습니다" |

---

## 6. 이 기능에 의존하는 항목

- **분기 셀(#4):** 분기 경로를 조건문으로 변환하는 로직 필요
- **Broadcasting/Aggregating(#7):** 병렬 실행 패턴을 `asyncio.gather`로 변환 필요
- **파이프라인 자동 인식(#3):** 다중 파이프라인 각각을 별도 파일로 Export
