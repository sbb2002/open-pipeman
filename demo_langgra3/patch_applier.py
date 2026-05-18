# patch_applier.py v2
import os
import json
import sys

ANCHOR_SEARCH_RADIUS = 10  # from/to 기준 ±N줄 범위 내에서만 앵커 탐색


def find_anchor_line(lines, anchor, near_line, radius=ANCHOR_SEARCH_RADIUS):
    """
    anchor 문자열과 일치하는 줄을 near_line(1-based) 기준 ±radius 범위 내에서 탐색.
    반환값:
        1-based 줄 번호  → 유일하게 발견
        None             → 범위 내 미발견
        -1               → 범위 내 중복 발견
    """
    lo = max(0, near_line - 1 - radius)
    hi = min(len(lines), near_line - 1 + radius + 1)
    search_window = lines[lo:hi]

    matches = []
    for i, line in enumerate(search_window):
        if line.rstrip('\n').startswith(anchor.rstrip('\n')):
            matches.append(lo + i + 1)  # 1-based

    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        return -1   # 중복
    return None     # 미발견


def verify_anchor(lines, anchor, label, json_line, radius=ANCHOR_SEARCH_RADIUS):
    """
    앵커를 탐색하고 결과에 따라 에러 메시지를 출력한다.
    반환값: True(검증 통과) / False(검증 실패)
    label   : 'anchor_start' 또는 'anchor_end' (에러 메시지용)
    json_line: JSON에 적힌 from 또는 to 값
    """
    result = find_anchor_line(lines, anchor, json_line, radius)

    if result is None:
        print(f"❌ 앵커 미발견 [{label}]: '{anchor}'")
        print(f"   JSON 줄={json_line} 기준 ±{radius}줄 범위에서 찾을 수 없습니다.")
        print(f"   → 줄 번호가 밀렸을 가능성이 높습니다.")
        print(f"   → 파일을 직접 열어 확인하거나, 파일을 재업로드하십시오.")
        return False

    if result == -1:
        print(f"⚠️  앵커 중복 [{label}]: '{anchor}'")
        print(f"   JSON 줄={json_line} 기준 ±{radius}줄 범위 내에 동일 앵커가 여러 줄 존재합니다.")
        print(f"   → anchor 문자열을 더 길게(20글자 이상) 지정하십시오.")
        return False

    if result != json_line:
        print(f"⚠️  앵커 위치 불일치 [{label}]: '{anchor}'")
        print(f"   JSON 줄={json_line}  /  실제 앵커 발견 위치={result}줄")
        print(f"   → JSON의 해당 줄 번호를 {result}로 수정한 뒤 다시 시도하십시오.")
        return False

    return True  # 검증 통과


def apply_file_patches(file_path, targets):
    if not os.path.exists(file_path):
        print(f"❌ 에러: 파일을 찾을 수 없습니다: {file_path}")
        return False

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 줄 단위로 분리 (줄바꿈 문자 보존)
        lines = content.splitlines(keepends=True)
        total_lines = len(lines)

        # ── 1단계: 기본 무결성 검사 ───────────────────
        sorted_targets = sorted(targets, key=lambda x: int(x['from']))
        prev_end = -1
        for t in sorted_targets:
            f_line  = int(t['from'])
            to_line = int(t['to'])
            if f_line < 1 or to_line > total_lines + 1:
                print(f"❌ 에러: 범위 초과 (from={f_line}, to={to_line}, 파일 총 {total_lines}줄)")
                return False
            if f_line > to_line:
                print(f"❌ 에러: from({f_line}) > to({to_line})")
                return False
            if f_line <= prev_end:
                print(f"❌ 에러: target 범위 중복 (from={f_line}이 이전 끝 {prev_end}과 겹침)")
                return False
            prev_end = to_line

        # ── 2단계: 앵커 검증 (anchor_start / anchor_end) ──
        for t in sorted_targets:
            f_line       = int(t['from'])
            to_line      = int(t['to'])
            anchor_start = t.get('anchor_start')
            anchor_end   = t.get('anchor_end')

            if anchor_start:
                if not verify_anchor(lines, anchor_start, 'anchor_start', f_line):
                    return False

            # 삽입 모드(from == to)는 anchor_end 생략 허용
            if anchor_end and f_line != to_line:
                if not verify_anchor(lines, anchor_end, 'anchor_end', to_line):
                    return False

        # ── 3단계: 역순 적용 (뒤에서부터 교체해야 앞 줄번호가 밀리지 않음) ──
        for target in sorted(targets, key=lambda x: int(x['from']), reverse=True):
            start_idx = int(target['from']) - 1  # 0-based
            end_idx   = int(target['to'])         # 슬라이싱 끝 (exclusive)
            new_code  = target.get('replace', '')
            is_insert = int(target['from']) == int(target['to'])

            if new_code == '':
                new_lines = []
            else:
                parts = new_code.splitlines()
                new_lines = [p + '\n' for p in parts]
                # 원본 replace 마지막에 줄바꿈 없으면 마지막 줄 줄바꿈 제거
                if not new_code.endswith('\n') and new_lines:
                    new_lines[-1] = new_lines[-1].rstrip('\n')

            if is_insert:
                lines[start_idx:start_idx] = new_lines
            else:
                lines[start_idx:end_idx] = new_lines

        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)

        print(f"✅ 성공: {file_path} ({len(targets)}개 지점 수정 완료)")
        return True

    except Exception as e:
        print(f"❌ 에러 ({file_path}): {e}")
        return False


def main():
    print("--- Claude Line-based Patch Applier v2 ---")
    print("JSON 패치를 입력하고 Enter를 누르세요. (입력 종료: Ctrl+D(Mac/Linux) 또는 Ctrl+Z(Windows))")

    input_data = sys.stdin.read()

    try:
        json_str = input_data.strip()
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0].strip()

        changes = json.loads(json_str)

        if not isinstance(changes, list):
            print("❌ 에러: JSON 형식이 리스트([])가 아닙니다.")
            return

        for change in changes:
            file_path = change.get('file')
            targets   = change.get('target', [])
            version   = change.get('version', '?')
            if file_path and targets:
                print(f"ℹ️  적용 중: {file_path} (v{version})")
                apply_file_patches(file_path, targets)

    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 에러: {e}")
    except Exception as e:
        print(f"❌ 실행 중 에러 발생: {e}")


if __name__ == "__main__":
    main()