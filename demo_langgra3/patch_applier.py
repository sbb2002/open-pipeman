# patch_applier.py v3
import os
import json
import sys

ANCHOR_SEARCH_RADIUS = 10  # from/to 기준 ±N줄 범위 내에서만 앵커 탐색
CONTEXT_LINES = 3          # 리포트에 출력할 변경 전후 컨텍스트 줄 수


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


def verify_and_resolve_anchor(lines, anchor, label, json_line, radius=ANCHOR_SEARCH_RADIUS):
    """
    앵커를 탐색하고 실제 위치를 반환한다. 줄 번호가 밀린 경우 자동 보정.
    반환값:
        (actual_line, offset)  → 검증 통과 (offset = actual - json_line, 보정량)
        None                   → 검증 실패 (중복 또는 미발견)
    label   : 'anchor_start' 또는 'anchor_end' (에러 메시지용)
    json_line: JSON에 적힌 from 또는 to 값
    """
    result = find_anchor_line(lines, anchor, json_line, radius)

    if result is None:
        print(f"❌ 앵커 미발견 [{label}]: '{anchor}'")
        print(f"   JSON 줄={json_line} 기준 ±{radius}줄 범위에서 찾을 수 없습니다.")
        print(f"   → 줄 번호가 너무 많이 밀렸을 가능성이 높습니다.")
        print(f"   → 파일을 재업로드한 뒤 patch_applier.py 출력의 '다음 패치 기준' 섹션을 참고하여 줄 번호를 다시 작성하십시오.")
        return None

    if result == -1:
        print(f"⚠️  앵커 중복 [{label}]: '{anchor}'")
        print(f"   JSON 줄={json_line} 기준 ±{radius}줄 범위 내에 동일 앵커가 여러 줄 존재합니다.")
        print(f"   → anchor 문자열을 더 길게(30글자 이상) 지정하십시오.")
        return None

    offset = result - json_line
    if offset != 0:
        print(f"⚠️  앵커 위치 자동 보정 [{label}]: JSON 줄={json_line} → 실제 줄={result} (offset {offset:+d})")
    return (result, offset)


def format_context_block(lines, start_1based, end_1based, label_start=None, label_end=None):
    """
    lines에서 start_1based ~ end_1based 구간을 줄 번호와 함께 포맷하여 반환.
    label_start/label_end 줄에는 화살표 표시.
    """
    result = []
    for i in range(max(0, start_1based - 1), min(len(lines), end_1based)):
        lineno = i + 1
        text = lines[i].rstrip('\n')
        marker = ''
        if label_start is not None and lineno == label_start:
            marker = '  ← 변경 시작'
        elif label_end is not None and lineno == label_end:
            marker = '  ← 변경 끝'
        result.append(f"  L{lineno:>4}: {text}{marker}")
    return '\n'.join(result)


def apply_file_patches(file_path, targets):
    if not os.path.exists(file_path):
        print(f"❌ 에러: 파일을 찾을 수 없습니다: {file_path}")
        return False

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        lines = content.splitlines(keepends=True)
        total_lines_before = len(lines)

        # ── 1단계: 기본 무결성 검사 ───────────────────────────────────────────
        sorted_targets = sorted(targets, key=lambda x: int(x['from']))
        prev_end = -1
        for t in sorted_targets:
            f_line  = int(t['from'])
            to_line = int(t['to'])
            if f_line < 1 or to_line > total_lines_before + 1:
                print(f"❌ 에러: 범위 초과 (from={f_line}, to={to_line}, 파일 총 {total_lines_before}줄)")
                return False
            if f_line > to_line:
                print(f"❌ 에러: from({f_line}) > to({to_line})")
                return False
            if f_line <= prev_end:
                print(f"❌ 에러: target 범위 중복 (from={f_line}이 이전 끝 {prev_end}과 겹침)")
                return False
            prev_end = to_line

        # ── 2단계: 앵커 검증 및 자동 보정 ────────────────────────────────────
        # 앵커 보정값을 저장하여 실제 적용 범위에 반영한다.
        resolved_targets = []
        for t in sorted_targets:
            f_line       = int(t['from'])
            to_line      = int(t['to'])
            anchor_start = t.get('anchor_start')
            anchor_end   = t.get('anchor_end')
            is_insert    = (f_line == to_line)

            actual_from = f_line
            actual_to   = to_line

            if anchor_start:
                res = verify_and_resolve_anchor(lines, anchor_start, 'anchor_start', f_line)
                if res is None:
                    return False
                actual_from, offset_start = res
                # anchor_end가 없는 경우 to도 같은 offset으로 보정
                if not anchor_end or is_insert:
                    actual_to = to_line + offset_start

            if anchor_end and not is_insert:
                res = verify_and_resolve_anchor(lines, anchor_end, 'anchor_end', to_line)
                if res is None:
                    return False
                actual_to, _ = res

            resolved_targets.append({
                **t,
                '_actual_from': actual_from,
                '_actual_to':   actual_to,
            })

        # ── 3단계: 역순 적용 ──────────────────────────────────────────────────
        # 보정된 실제 줄 번호(_actual_from/_actual_to) 기준으로 역순 적용.
        applied_reports = []  # 리포트용 정보 수집 (순방향 순서 유지)

        for target in sorted(resolved_targets, key=lambda x: x['_actual_from'], reverse=True):
            actual_from = target['_actual_from']
            actual_to   = target['_actual_to']
            json_from   = int(target['from'])
            json_to     = int(target['to'])
            new_code    = target.get('replace', '')
            is_insert   = (json_from == json_to)

            start_idx = actual_from - 1  # 0-based
            end_idx   = actual_to        # 슬라이싱 끝 (exclusive)

            original_line_count = actual_to - actual_from + 1 if not is_insert else 0

            if new_code == '':
                new_lines = []
            else:
                parts = new_code.splitlines()
                new_lines = [p + '\n' for p in parts]
                if not new_code.endswith('\n') and new_lines:
                    new_lines[-1] = new_lines[-1].rstrip('\n')

            replace_line_count = len(new_lines)
            delta = replace_line_count - original_line_count

            if is_insert:
                lines[start_idx:start_idx] = new_lines
            else:
                lines[start_idx:end_idx] = new_lines

            applied_reports.append({
                'json_from':    json_from,
                'json_to':      json_to,
                'actual_from':  actual_from,
                'actual_to':    actual_to,
                'replace_count': replace_line_count,
                'original_count': original_line_count,
                'delta':        delta,
                'is_insert':    is_insert,
            })

        total_lines_after = len(lines)
        total_delta = total_lines_after - total_lines_before

        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)

        # ── 4단계: 적용 후 리포트 출력 ───────────────────────────────────────
        print(f"✅ 성공: {file_path} ({len(targets)}개 지점 수정 완료)")
        print()
        print("── 변경 구간 리포트 ──────────────────────────────────────────────────")

        cumulative_delta = 0
        new_actual_positions = []  # 다음 패치 기준 힌트용 (새 줄 번호)

        for idx, r in enumerate(sorted(applied_reports, key=lambda x: x['actual_from']), 1):
            kind = "삽입" if r['is_insert'] else "교체"
            corrected = r['actual_from'] != r['json_from']
            correction_note = f" (앵커 보정 {r['actual_from'] - r['json_from']:+d}줄)" if corrected else ""

            new_from = r['actual_from'] + cumulative_delta
            new_to   = new_from + r['replace_count'] - 1

            print(f"[target {idx}] {kind} 완료{correction_note}")
            if not r['is_insert']:
                print(f"  JSON 범위:    {r['json_from']}~{r['json_to']}줄")
                print(f"  실제 적용:    {r['actual_from']}~{r['actual_to']}줄 (원본 {r['original_count']}줄)")
            else:
                print(f"  JSON 위치:    {r['json_from']}줄 앞 삽입")
                print(f"  실제 적용:    {r['actual_from']}줄 앞 삽입")
            print(f"  교체 후 줄수: {r['replace_count']}줄  /  delta: {r['delta']:+d}줄")
            print(f"  새 파일 기준: L{new_from}~L{new_to}")

            new_actual_positions.append((new_from, new_to))
            cumulative_delta += r['delta']

        print()
        print("── 파일 현황 ────────────────────────────────────────────────────────")
        print(f"  수정 전 총 줄 수: {total_lines_before}줄")
        print(f"  수정 후 총 줄 수: {total_lines_after}줄")
        print(f"  누적 delta:       {total_delta:+d}줄")
        print()

        # ── 5단계: 다음 패치 기준 컨텍스트 출력 ──────────────────────────────
        # Claude가 다음 패치를 작성할 때 v1 기억 대신 이 출력을 기준으로 삼도록 한다.
        print("── 다음 패치 기준 (새 줄 번호 기준 전후 컨텍스트) ──────────────────")
        print("  ※ 이 섹션의 줄 번호와 내용을 다음 패치의 from/to/anchor 기준으로 사용하십시오.")
        print("     이전 view 결과나 패치 전 기억은 폐기하고 아래 내용만 신뢰하십시오.")
        print()

        for idx, (new_from, new_to) in enumerate(new_actual_positions, 1):
            ctx_start = max(1, new_from - CONTEXT_LINES)
            ctx_end   = min(len(lines), new_to + CONTEXT_LINES)
            print(f"  [target {idx} 전후 컨텍스트]")
            print(format_context_block(lines, ctx_start, ctx_end, new_from, new_to))
            print()

        return True

    except Exception as e:
        print(f"❌ 에러 ({file_path}): {e}")
        return False


def main():
    print("--- Claude Line-based Patch Applier v3 ---")
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