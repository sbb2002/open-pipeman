# Wiki Index

이 폴더는 복잡도가 높은 미구현 항목에 대한 구현 설계 문서를 담는다.  
LLM이 세션 초입에 참조할 수 있도록 **LLM 친화적 구조**로 작성되어 있다.

전체 미구현 목록 및 우선순위는 [[../specs]] 또는 `archive/ref_html/feature_spec.html`을 참조.  
코드베이스 구조는 [[../structure]] 참조.

---

## 문서 목록

| 파일 | 항목 | 우선순위 | 복잡도 |
|---|---|---|---|
| [[pipeline-validation]] | #2 n(INPUT)==n(OUTPUT) 검증, #3 파이프라인 자동 인식 | 1 | ★★ |
| [[branch-reference-cell]] | #4 분기 셀, #5 참조 셀, #6 점선 엣지 | 2 | ★★★ |
| [[broadcasting-aggregating]] | #7 Broadcasting / Aggregating 전략 | 2 | ★★★ |
| [[project-config-skill-md]] | #8 Project Config 트레이 (Skill.md 전역) | 2 | ★★ |
| [[export]] | #9 Export (JSON / file+zip) | 3 | ★★ |

---

## 구현 의존 관계

```
detectPipelines() [#3]
  ├─▶ n(INPUT)==n(OUTPUT) 검증 [#2]
  ├─▶ Broadcasting/Aggregating [#7]
  └─▶ Export [#9]

분기 셀 [#4]
  ├─▶ Broadcasting/Aggregating [#7]
  └─▶ Export [#9]

topoSort() 레이어화 [#7 선결]
  └─▶ hitl.js resumeCell() 수정 동반
```

---

## 작성 규칙

- 각 문서는 **현재 구현 상태 → 설계 → 파일별 수정 범위** 순으로 기술한다.
- 코드 스니펫은 실제 파일의 변수명·함수명을 그대로 사용한다.
- 엣지 케이스 섹션을 반드시 포함한다.
- 구현 완료 시 해당 문서 상단에 `> ✅ 구현 완료 — YYYYMMDD` 한 줄 추가.
