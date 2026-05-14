import json

def calculator(parsed_expression_json):
    """
    ParsedExpression JSON을 입력받아 사칙연산 우선순위에 따라 계산을 수행합니다.
    """
    try:
        # JSON 문자열인 경우 파싱, 딕셔너리인 경우 그대로 사용
        if isinstance(parsed_expression_json, str):
            data = json.loads(parsed_expression_json)
        else:
            data = parsed_expression_json
            
        operands = list(data["operands"])
        operators = list(data["operators"])
        
        # 원본 수식 문자열 생성 (결과 반환용)
        original_expr = ""
        for i in range(len(operators)):
            original_expr += f"{operands[i]} {operators[i]} "
        original_expr += str(operands[-1])
        
        steps = []
        
        # 1단계: 곱셈(*)과 나눗셈(/) 먼저 처리
        i = 0
        while i < len(operators):
            if operators[i] in ['*', '/']:
                op = operators.pop(i)
                left = operands.pop(i)
                right = operands.pop(i)
                
                if op == '*':
                    res = left * right
                else:  # op == '/'
                    if right == 0:
                        return json.dumps({"error": "division_by_zero"}, ensure_ascii=False)
                    # 결과가 정수로 떨어지면 정수로, 아니면 실수로 유지
                    res = left / right
                    if res == int(res): res = int(res)
                
                operands.insert(i, res)
                steps.append(f"{left} {op} {right} = {res}")
            else:
                i += 1
        
        # 2단계: 덧셈(+)과 뺄셈(-) 처리
        while operators:
            op = operators.pop(0)
            left = operands.pop(0)
            right = operands.pop(0)
            
            if op == '+':
                res = left + right
            else:  # op == '-'
                res = left - right
            
            operands.insert(0, res)
            steps.append(f"{left} {op} {right} = {res}")
            
        final_result = operands[0]
        
        # 결과 구성
        output = {
            "expression": original_expr,
            "result": final_result,
            "steps": steps
        }
        
        return json.dumps(output, ensure_ascii=False)

    except (KeyError, IndexError, TypeError):
        return json.dumps({"error": "invalid_input"}, ensure_ascii=False)

# --- 테스트 실행 ---
# 입력 데이터: {operands: [3, 5, 2], operators: ["+", "*"]} -> 3 + 5 * 2
test_input = {
    "operands": [3, 5, 2],
    "operators": ["+", "*"]
}

print(f"Input JSON: {test_input}")
print(f"Output: {calculator(test_input)}")

# 0으로 나누는 케이스 테스트
div_zero_input = {
    "operands": [10, 0],
    "operators": ["/"]
}
print(f"\nZero Division Test: {calculator(div_zero_input)}")