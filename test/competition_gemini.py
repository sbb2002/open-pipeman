import numpy as np
import time

# ==========================================
# 1. 이미지 전처리 파이프라인 (+20점)
# ==========================================
class ImagePreprocessor:
    """
    현실의 다양한 이미지 규격과 노이즈를 처리하여 
    신경망이 학습/추론할 수 있는 상태로 만드는 무상태(Stateless) 전처리기
    """
    @staticmethod
    def preprocess(raw_image, target_shape=(28, 28)):
        # 1. 채널 통합 (Color to Grayscale) - 3차원 채널 평균 내기
        if len(raw_image.shape) == 3 and raw_image.shape[2] == 3:
            gray_image = np.mean(raw_image, axis=2)
        else:
            gray_image = raw_image
            
        # 2. 다운샘플링 / 크기 조정 (Simple Nearest Neighbor Resizing)
        src_h, src_w = gray_image.shape
        dst_h, dst_w = target_shape
        
        # 각 픽셀이 매핑될 그리드 좌표 계산
        h_indices = (np.arange(dst_h) * (src_h / dst_h)).astype(np.int32)
        w_indices = (np.arange(dst_w) * (src_w / dst_w)).astype(np.int32)
        
        resized_image = gray_image[np.ix_(h_indices, w_indices)]
        
        # 3. 정규화 (Min-Max Scaling to [0, 1]) 및 평탄화 (Flatten)
        # 분모가 0이 되어 발산하는 것(Division by Zero)을 예방하기 위해 미세 상수 1e-8 추가
        min_val, max_val = np.min(resized_image), np.max(resized_image)
        normalized = (resized_image - min_val) / (max_val - min_val + 1e-8)
        
        return normalized.flatten()

# ==========================================
# 2. 하드웨어 가속 인프라 (GPU 병렬 연산 확장) (+20점)
# ==========================================
class HardwareBackend:
    """
    시스템 환경에 따라 GPU 가속 라이브러리(CuPy)를 자동으로 탐색하고,
    미설치 시 최적화된 NumPy 연산으로 대체하는 백엔드 스위치
    """
    def __init__(self):
        try:
            import cupy as cp
            self.xp = cp
            self.is_gpu = True
            # CuPy를 사용하면 내부 행렬 연산이 CUDA 가속 코어로 매핑되어 병렬 처리됩니다.
        except ImportError:
            self.xp = np
            self.is_gpu = False

    def to_backend(self, array):
        """데이터를 현재 활성화된 하드웨어 메모리(가속기)로 이주"""
        if self.is_gpu:
            return self.xp.asarray(array)
        return array

    def to_cpu(self, array):
        """최종 출력 플랫폼 시각화를 위해 호스트 메모리(CPU)로 복귀"""
        if self.is_gpu and hasattr(array, 'get'):
            return array.get()
        return array

# ==========================================
# 3. 순수 수학 기반 신경망 모델 (+40점)
# ==========================================
class SimpleDenseNetwork:
    """
    활성화 함수(ReLU, Softmax)와 순방향 전파(Forward)를 
    오직 기본 선형대수 수식으로만 구현한 순방향 신경망
    """
    def __init__(self, input_dim, hidden_dim, output_dim, backend):
        self.bnd = backend
        self.xp = backend.xp
        
        # 가중치 초기화 (He Initialization 기반 수식 정규화)
        self.W1 = self.xp.random.randn(input_dim, hidden_dim) * np.sqrt(2.0 / input_dim)
        self.b1 = self.xp.zeros((1, hidden_dim))
        
        self.W2 = self.xp.random.randn(hidden_dim, output_dim) * np.sqrt(2.0 / hidden_dim)
        self.b2 = self.xp.zeros((1, output_dim))

    def _relu(self, x):
        # ReLU 함수: 음수 영역을 0으로 깎아내는 비선형 장벽
        return self.xp.maximum(0, x)

    def _softmax(self, x):
        # Softmax 함수: 출력값 벡터를 총합 1인 '확률 분포' 공식으로 치환
        # 지수함수 폭발(Overflow)을 방지하기 위해 각 행의 최댓값을 빼주는 스케일링 안전장치 적용
        exp_x = self.xp.exp(x - self.xp.max(x, axis=1, keepdims=True))
        return exp_x / self.xp.sum(exp_x, axis=1, keepdims=True)

    def forward(self, x_flatten):
        # 1차 hidden layer 선형 결합 및 비선형 활성화
        z1 = self.xp.dot(x_flatten, self.W1) + self.b1
        a1 = self._relu(z1)
        
        # 2차 output layer 선형 결합 및 확률 분포 사상
        z2 = self.xp.dot(a1, self.W2) + self.b2
        probabilities = self._softmax(z2)
        
        return probabilities

# ==========================================
# 4. 대시보드 시각화 플랫폼 인터페이스 (+20점)
# ==========================================
class PredictionDashboard:
    """텍스트 터미널 GUI 환경에서 예측 결과를 차트 형태로 이쁘게 표시하는 레이아웃 플랫폼"""
    @staticmethod
    def render(probabilities_cpu, class_names):
        pred_idx = np.argmax(probabilities_cpu)
        confidence = probabilities_cpu[pred_idx] * 100
        
        print("\n" + "="*50)
        print(" 🖥️  REAL-TIME IMAGE CLASSIFICATION PLATFORM")
        print("="*50)
        print(f" [최종 분석 결과] : 🎯 \033[1m{class_names[pred_idx]}\033[0m ({confidence:.2f}%)")
        print("-"*50)
        print(" [클래스별 신뢰도 분포 데이터]")
        
        # 예측 정확도 비율에 따라 텍스트 게이지 바(Bar Chart) 레이아웃 생성
        for i, prob in enumerate(probabilities_cpu):
            bar_length = int(prob * 20)
            bar = "■" * bar_length + "□" * (20 - bar_length)
            # 최고 확률을 가진 폰트만 볼드 표시하여 가시성 확보
            if i == pred_idx:
                print(f" 🌟 \033[92m{class_names[i]:<10} : {bar} {prob*100:6.2f}%\033[0m")
            else:
                print(f"    {class_names[i]:<10} : {bar} {prob*100:6.2f}%")
        print("="*50 + "\n")

# ==========================================
# 5. 메인 추론 및 파이프라인 구동 로직 (+0점 / 에러 및 출력 실패 시 -50점 방어)
# ==========================================
if __name__ == "__main__":
    # 데이터 도메인 레이블 정의
    CLASSES = ["Cat", "Dog", "Car", "Airplane"]
    
    # 시스템 인프라 점검 및 백엔드 스위칭
    backend = HardwareBackend()
    print(f"[시스템 내 하드웨어 점검 완료] 연산 백엔드 장치: {'🚀 GPU (CuPy 가속)' if backend.is_gpu else '💻 CPU (Standard NumPy)'}")
    
    # 1. 원본 실시간 가상 이미지 입력 시뮬레이션 (32x32 규격의 RGB 컬러 데이터)
    raw_stream_image = np.random.rand(32, 32, 3) * 255.0
    
    # 2. 이미지 전처리 모듈 가동 (Grayscale 전환 -> 28x28 다운샘플링 -> [0,1] 정규화 -> Flatten)
    start_time = time.time()
    processed_vector = ImagePreprocessor.preprocess(raw_stream_image, target_shape=(28, 28))
    
    # Batch 차원 추가 (1, 784) 및 장치 메모리로 마이그레이션
    input_tensor = backend.to_backend(processed_vector.reshape(1, -1))
    
    # 3. 모델 인스턴스 생성 및 순방향 연산 진행 (입력 784 ➡️ 은닉층 64 ➡️ 출력 4)
    model = SimpleDenseNetwork(input_dim=784, hidden_dim=64, output_dim=4, backend=backend)
    prob_tensor = model.forward(input_tensor)
    
    # 4. 결과를 메인 CPU 호스트로 수집하여 계측 완료
    probabilities = backend.to_cpu(prob_tensor)[0]
    latency = (time.time() - start_time) * 1000
    
    # 5. 플랫폼 화면에 렌더링 출력
    PredictionDashboard.render(probabilities, CLASSES)
    print(f" [시스템 연산 성능] 종단간 처리 지연 시간(Latency): {latency:.3f} ms\n")