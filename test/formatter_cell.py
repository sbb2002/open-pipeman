import json

def result_formatter(calculation_result_json):
    """
    계산 결과 JSON을 사람이 읽기 좋은 문자열 형태로 포맷팅합니다.
    """
    try:
        # JSON 문자열인 경우 파싱, 딕셔너리인 경우 그대로 사용
        if isinstance(calculation_result_json, str):
            data = json.loads(calculation_result_json)
        else:
            data = calculation_result_json

        # 에러 발생 시 처리
        if "error" in data:
            error_msg = data["error"]
            if error_msg == "division_by_zero":
                return "오류: 0으로 나눌 수 없습니다."
            return f"오류: 잘못된 입력입니다. ({error_msg})"

        # 데이터 추출
        expression = data.get("expression", "")
        result = data.get("result", "")
        steps = data.get("steps", [])

        # 1. 수식 내 기호를 가독성 좋게 치환 (* -> ×, / -> ÷)
        display_expr = expression.replace("*", "×").replace("/", "÷")
        
        # 2. 계산 단계(steps) 포맷팅
        formatted_steps = []
        for step in steps:
            # 각 단계의 문자열도 기호 치환
            formatted_step = step.replace("*", "×").replace("/", "÷")
            formatted_steps.append(formatted_step)
        
        steps_str = ", ".join(formatted_steps)

        # 3. 최종 문자열 조립
        # 예시: "3 + 5 × 2 = 13 (계산 순서: 5×2=10, 3+10=13)"
        formatted_output = f"{display_expr} = {result} (계산 순서: {steps_str})"
        
        return formatted_output

    except Exception as e:
        return f"포맷팅 중 오류가 발생했습니다: {str(e)}"

# --- 테스트 실행 ---
# Calculator 셀로부터 전달받은 가상의 Input 데이터
test_input = {
    "expression": "3 + 5 * 2",
    "result": 13,
    "steps": ["5 * 2 = 10", "3 + 10 = 13"]
}

print("--- Formatted Output ---")
print(result_formatter(test_input))

# 나눗셈 포함 예시
test_input_div = {
    "expression": "10 / 2 + 7",
    "result": 12,
    "steps": ["10 / 2 = 5", "5 + 7 = 12"]
}
print(result_formatter(test_input_div))