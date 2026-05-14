from parser_cell import expression_parser
from calculator_cell import calculator
from formatter_cell import result_formatter

def calculator_app(user_input: str) -> str:
    # 1. Parser Cell
    parsed = expression_parser(user_input)
    
    # 2. Calculator Cell
    calculated = calculator(parsed)
    
    # 3. Formatter Cell
    result = result_formatter(calculated)
    
    return result

# 실행
if __name__ == "__main__":
    while True:
        expr = input("수식 입력 (종료: q): ")
        if expr.lower() == 'q':
            break
        print(result_formatter(calculator(expression_parser(expr))))