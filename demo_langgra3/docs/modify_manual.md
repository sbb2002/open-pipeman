# 코드 수정 지침 (Script Mode)

## 작업 환경

* **filesystem MCP** 를 통해 프로젝트 파일을 직접 읽고 쓴다. 사용자에게 파일 업로드를 요청하거나, outputs에 복사 후 `present_files`로 전달하는 방식은 더 이상 사용하지 않는다.
* 프로젝트 루트: `C:\Users\user\Documents\myprojects\open-pipeman\demo_langgra3`
* **`docs/` 폴더는 작업과 무관한 템플릿/패치내역 보관소다. 명시적 요청이 없는 한 절대 탐색하거나 읽지 말 것.**

---

## 기본 절차

1. 수정 요청을 받으면 `structure.md`를 참고하여 수정할 파일을 파악하시오.
2. `filesystem:read_text_file`로 해당 파일을 직접 읽고 수정 작업을 시작하시오.
3. 새 기능/코드가 기존 기능과 충돌할 우려가 있는지 검사하시오. 충돌 우려가 있으면 미리 사용자에게 알리고 확인 후 진행하시오.
4. **파일 편집·추가·삭제 전에는 반드시 사용자에게 허락을 받을 것.** 이 규칙은 어떤 상황에서도 생략 불가.
5. 허락을 받은 뒤 아래 수정 방법 기준에 따라 작업하시오.

---

## 수정 방법 선택 기준

| 상황 | 방법 |
|---|---|
| 변경 위치가 명확한 1~10곳 | **str.replace 스크립트** (`bash_tool`) |
| 변경량이 파일 전체의 30% 이상이거나 구조가 크게 바뀌는 경우 | **filesystem:write_file 통파일 재작성** |

---

## str.replace 스크립트 작성 규칙

파일을 `/home/claude/`에 복사한 뒤 `bash_tool`로 Python str.replace 스크립트를 실행하고, 완료 후 `filesystem:write_file`로 원본 경로에 덮어쓴다.

### 기본 형태

```python
with open('/home/claude/파일명', 'r', encoding='utf-8') as f:
    src = f.read()

old = """교체할 원본 코드"""
new = """새 코드"""

assert old in src, "MISS: 타깃 문자열을 찾을 수 없음"
src = src.replace(old, new, 1)

with open('/home/claude/파일명', 'w', encoding='utf-8') as f:
    f.write(src)

print("OK")
```

### 핵심 규칙

* **`assert`는 생략 불가.** 타깃 미발견 시 즉시 실패로 처리하고 원인을 파악한 뒤 재시도할 것.
* **`replace(old, new, 1)`의 세 번째 인자 `1`은 생략 불가.** 동일 문자열이 여러 곳에 있을 때 첫 번째만 교체하기 위함.
* **`old`는 파일에서 유일하게 식별 가능한 충분한 컨텍스트를 포함해야 함.** 짧은 한 줄보다 전후 2~3줄을 포함하는 것이 안전.
* **들여쓰기·공백·줄바꿈을 파일 원본과 정확히 일치시킬 것.** 불일치 시 assert 실패.
* **여러 곳을 수정할 때는 각각 별도의 replace 블록으로 작성하고 각각 assert를 둘 것.**

### 여러 곳 수정 예시

```python
with open('/home/claude/파일명', 'r', encoding='utf-8') as f:
    src = f.read()

# 수정 1
old1 = """..."""
new1 = """..."""
assert old1 in src, "MISS 1"
src = src.replace(old1, new1, 1)

# 수정 2
old2 = """..."""
new2 = """..."""
assert old2 in src, "MISS 2"
src = src.replace(old2, new2, 1)

with open('/home/claude/파일명', 'w', encoding='utf-8') as f:
    f.write(src)

print("Done. Lines:", src.count('\n'))
```

---

## 통파일 재작성 규칙

* `filesystem:read_text_file`로 파일 전체를 읽은 뒤 수정된 내용 전체를 `filesystem:write_file`로 원본 경로에 직접 저장한다.
* 수정하지 않는 부분도 빠짐없이 포함해야 함. `# 이하 동일` 등의 생략 표현 절대 금지.

---

## 수정 후 검증

스크립트 실행 후 아래를 확인할 것:

```bash
# 핵심 변경 부분이 실제로 반영됐는지 grep으로 확인
grep -n "변경된_키워드" /home/claude/파일명
```

* assert가 통과했더라도 결과물의 핵심 부분을 눈으로 확인하시오.
* 수정된 기능: 모두 반영됐는가
* 수정하지 않은 기능: 원본 유지됐는가
* `index.html`을 열었을 때 정상 동작해야 함

---

## 주의사항

* **파일 편집·추가·삭제 전 사용자 허락은 절대 원칙.** `modify_manual.md` 명시 여부와 무관하게 항상 적용.
* **`docs/` 폴더는 읽지 말 것.** 명시적 요청이 있을 때만 접근.
* **줄 번호에 의존하지 말 것.** str.replace는 줄 번호가 필요 없음.
* **assert 실패 시 `filesystem:read_text_file`로 해당 부분을 다시 확인하고 `old` 문자열을 정확히 맞출 것.** 기억이나 추론으로 재시도하지 말 것.
* **`patch_applier.py`와 JSON 패치 방식은 더 이상 사용하지 않음.**
