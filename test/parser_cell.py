import re
import json

def expression_parser(user_expression):
    """
    사용자 입력 수식을 파싱하여 피연산자와 연산자를 분리합니다.
    """
    # 공백 제거
    expression = user_expression.replace(" ", "")
    
    # 1. 숫자(피연산자)와 연산자(+, -, *, /) 추출을 위한 정규식
    # 피연산자 추출
    operands_str = re.findall(r'\d+', expression)
    # 연산자 추출
    operators = re.findall(r'[\+\-\*/]', expression)
    
    # 2. 유효성 검사
    # - 수식에 숫자나 연산자 외의 문자가 포함되어 있는지 확인
    # - 피연산자의 개수가 연산자보다 정확히 1개 더 많은지 확인 (기본적인 이항 연산 구조)
    invalid_chars = re.sub(r'[\d\+\-\*/]', '', expression)
    
    if invalid_chars or not operands_str or len(operands_str) != len(operators) + 1:
        return json.dumps({"error": "invalid"}, ensure_ascii=False)

    try:
        # 피연산자를 정수형으로 변환
        operands = [int(num) for num in operands_str]
        
        # 결과 객체 생성
        result = {
            "operands": operands,
            "operators": operators
        }
        return json.dumps(result, ensure_ascii=False)
        
    except ValueError:
        return json.dumps({"error": "invalid"}, ensure_ascii=False)

# --- 테스트 실행 ---
test_inputs = [
    "3 + 5 * 2",      # 정상 입력
    "10 - 2 / 5",     # 정상 입력
    "100 ++ 50",      # 잘못된 연산자 중첩
    "hello + 3",      # 문자 포함
    "10 + "           # 미완성 수식
]

for inp in test_inputs:
    print(f"Input: {inp}")
    print(f"Output: {expression_parser(inp)}")
    print("-" * 30)