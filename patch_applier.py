# patch_applier.py
import os
import json
import sys

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

        # ── 무결성 검사 ───────────────────────────────
        sorted_targets = sorted(targets, key=lambda x: int(x['from']))
        prev_end = -1
        for t in sorted_targets:
            f_line = int(t['from'])
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

        # ── 역순 적용 (뒤에서부터 교체해야 앞 줄번호가 밀리지 않음) ──
        for target in sorted(targets, key=lambda x: int(x['from']), reverse=True):
            start_idx = int(target['from']) - 1  # 0-based
            end_idx   = int(target['to'])         # 슬라이싱 끝 (exclusive)
            new_code  = target.get('replace', '')

            # 삽입 모드 (from == to): 해당 줄 앞에 삽입, 기존 줄 유지
            is_insert = int(target['from']) == int(target['to'])

            # replace 내용을 줄 단위 리스트로 변환
            if new_code == '':
                new_lines = []
            else:
                # splitlines로 분리 후 각 줄에 줄바꿈 복원
                parts = new_code.splitlines()
                new_lines = [p + '\n' for p in parts]
                # 원본 replace 마지막에 줄바꿈 없으면 마지막 줄 줄바꿈 제거
                if not new_code.endswith('\n') and new_lines:
                    new_lines[-1] = new_lines[-1].rstrip('\n')

            if is_insert:
                # 삽입: 기존 줄을 보존하고 그 앞에 new_lines 삽입
                lines[start_idx:start_idx] = new_lines
            else:
                # 교체: start_idx ~ end_idx 구간을 new_lines로 대체
                lines[start_idx:end_idx] = new_lines

        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)

        print(f"✅ 성공: {file_path} ({len(targets)}개 지점 수정 완료)")
        return True

    except Exception as e:
        print(f"❌ 에러 ({file_path}): {e}")
        return False

def main():
    print("--- Claude Line-based Patch Applier ---")
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