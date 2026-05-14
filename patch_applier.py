import os
import json
import sys

def apply_file_patches(file_path, targets):
    """
    하나의 파일에 대해 여러 개의 패치를 역순으로 적용합니다.
    """
    if not os.path.exists(file_path):
        print(f"❌ 에러: 파일을 찾을 수 없습니다: {file_path}")
        return False

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # 라인 번호가 밀리는 것을 방지하기 위해 'from' 기준 역순(내림차순) 정렬
        sorted_targets = sorted(targets, key=lambda x: int(x['from']), reverse=True)

        for target in sorted_targets:
            # 리스트 인덱스는 0부터 시작하므로 from에서 1을 뺍니다.
            start_idx = int(target['from']) - 1
            end_idx = int(target['to'])
            
            # 제공된 JSON 규격에 맞춰 'replace' 필드 사용
            new_code = target.get('replace', '')

            if not new_code.endswith('\n') and new_code != '':
                new_code += '\n'
            
            # 해당 범위 교체
            lines[start_idx:end_idx] = [new_code]

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
    
    # 전체 입력을 한 번에 읽음
    input_data = sys.stdin.read()

    try:
        # 마크다운 코드 블록 제거 및 JSON 파싱
        json_str = input_data.strip()
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0].strip()
        
        # 제공해주신 형식(리스트)으로 바로 파싱
        changes = json.loads(json_str)

        if not isinstance(changes, list):
            print("❌ 에러: JSON 형식이 리스트([])가 아닙니다.")
            return

        for change in changes:
            file_path = change.get('file')
            # 제공해주신 규격인 'target' 필드 사용
            targets = change.get('target', [])
            if file_path and targets:
                apply_file_patches(file_path, targets)

    except json.JSONDecodeError as e:
        print(f"❌ JSON 파싱 에러: {e}")
    except Exception as e:
        print(f"❌ 실행 중 에러 발생: {e}")

if __name__ == "__main__":
    main()