# Project Config 트레이 (Skill.md 전역 적용)

> **관련 구현 항목:** [2순위] #8  
> **담당 파일:** `canvas.js`, `inspector.js`, `index.html`, `layout.css`  
> **선행 조건:** 없음 (독립 구현 가능)

---

## 1. 목표 요약

캔버스 툴 트레이와 구분선으로 분리된 별도 아이콘을 클릭하면 Skill.md를 업로드/편집할 수 있는 패널이 열린다. 설정된 Skill.md는 프로젝트 내 **모든 셀의 코드 생성 시 시스템 프롬프트에 자동 포함**된다.

---

## 2. 현재 구현 상태

### 툴 트레이 — `index.html` / `layout.css`

현재 툴 트레이에는 커서/팬 모드 버튼만 존재. Project Config 아이콘 없음.

### Inspector 셀 단위 Skill.md — `inspector.js`

셀 단위 Skill.md는 현재 미구현. Inspector 폼에 관련 필드 없음.  
→ 전역 Skill.md 구현이 셀 단위보다 먼저이거나 동시에 진행되어야 일관성 있음.

### `runner.js` `runCell()` body

현재 백엔드로 전달하는 body:

```js
{
  cell_id, prompt, model, upstream_schema,
  allow_cleanup, force_review, hr_strictness,
  allow_web_search, max_retries
}
```

`skill_md` 필드 없음. 백엔드(`api.py`, `nodes.py`)도 해당 필드를 받지 않음.

### `store.js`

`localStorage` CRUD 유틸(`storeGet/Set/Delete`)이 구현되어 있음.  
→ Skill.md 내용을 `localStorage`에 저장하는 데 즉시 활용 가능.

---

## 3. 구현 설계

### 3-1. 데이터 저장

Skill.md 내용을 `localStorage`에 저장:

```js
// store.js의 storeSet 활용
storeSet('project-skill-md', skillMdContent);

// 읽기
const skillMd = storeGet('project-skill-md') || '';
```

`state` 객체에 캐시 필드 추가:

```js
// state.js
state.skillMd = '';  // 앱 초기화 시 localStorage에서 로드
```

### 3-2. UI 구조 — 트레이 아이콘 + 패널

**툴 트레이에 구분선 + 아이콘 추가 (`index.html`):**

```html
<div class="tool-tray-divider"></div>
<button id="tool-project-config" class="tool-btn" title="Project Config (Skill.md)">⚙</button>
```

**패널 구조 (모달 또는 사이드 패널):**

```
┌─ Project Config ──────────────────────┐
│ Skill.md                              │
│ ┌────────────────────────────────┐    │
│ │ textarea (Skill.md 내용 편집)  │    │
│ └────────────────────────────────┘    │
│ [파일 업로드]   [Clear]   [Save]      │
└───────────────────────────────────────┘
```

기존 `showModal()` 또는 설정 팝업(`settings.js`) 패턴을 재사용하여 일관성 유지.

### 3-3. 백엔드 전달 — `runner.js` `runCell()` 수정

```js
const body = JSON.stringify({
  ...기존 필드,
  skill_md: state.skillMd || '',  // 전역 Skill.md 추가
});
```

### 3-4. 백엔드 수신 — `api.py` / `nodes.py`

`RunCellRequest`에 `skill_md: str = ''` 필드 추가.  
`inject_schema` 또는 `generate` 노드에서 `skill_md`가 있으면 시스템 프롬프트 끝에 추가:

```python
if state.get('skill_md'):
    system_prompt += f"\n\n---\n[Project Skill Guide]\n{state['skill_md']}"
```

---

## 4. 수정 범위 및 파일별 작업

### `index.html`
- 툴 트레이에 구분선(`.tool-tray-divider`) + `#tool-project-config` 버튼 추가
- Project Config 패널 HTML 추가 (모달 or 인라인 패널)

### `layout.css`
- `.tool-tray-divider` 스타일 추가
- Project Config 패널 스타일 추가

### `canvas.js` 또는 신규 `project-config.js`
- `#tool-project-config` 클릭 이벤트 → 패널 열기
- Skill.md 저장/로드 로직
- 파일 업로드(`FileReader`) 처리

### `state.js`
- `state.skillMd = ''` 필드 추가

### `runner.js`
- `runCell()` body에 `skill_md: state.skillMd` 추가

### `api.py`
- `RunCellRequest`에 `skill_md: str = ''` 추가

### `nodes.py`
- `CellState`에 `skill_md: str` 추가
- `generate` 노드 시스템 프롬프트 조립 시 `skill_md` 반영

---

## 5. 엣지 케이스

| 케이스 | 예상 동작 |
|---|---|
| Skill.md 비어 있음 | 시스템 프롬프트에 아무것도 추가 안 함 |
| Skill.md가 매우 긺 (토큰 초과 위험) | 경고 표시 (예: 5000자 초과 시). 잘라내기는 하지 않음 |
| 프로젝트 저장/로드 시 Skill.md 포함 여부 | `snapshot()`에 포함 필요 — `store.js` 확인 후 결정 |
| 셀 단위 Skill.md와 전역 Skill.md 공존 | 전역이 기본, 셀 단위가 override. 우선순위 명시 필요 |

---

## 6. 구현 파일 분리 검토

로직이 단순하다면 `canvas.js`에 추가해도 되지만, `canvas.js`가 이미 크기 때문에 `project-config.js` 신규 파일로 분리하는 것이 바람직하다. 분리 시 `index.html` 로드 순서에서 `runner.js` 이전에 삽입할 것 (`state.skillMd`를 runner가 참조하므로).
