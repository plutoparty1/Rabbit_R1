# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-10-07
- Primary product surfaces: rabbit r1의 240×282 한 화면.
- Evidence reviewed: 첨부 개발 명세, `creation/index.html`, `creation/style.css`, `creation/app.mjs`, `docs/device-test-report.md`, `docs/account-quota-probe.json`.
- 최신 사용자 요구: 계정 잔여 한도를 가장 먼저 확인하고, 필요할 때만 전체 세션의 응답 상황을 확인합니다. 불필요한 정보는 기본 화면에서 숨깁니다.

## Brand
- Personality: 조용하고 간결한 업무 상태창.
- Trust signals: 실제 API 값·갱신 시각·연결 상태를 명확히 구분합니다.
- Avoid: 가짜 수치, 미검증 연결의 성공 표시, 장식, 진단 로그의 기본 노출.

## Product goals
- Goals: 잔여 한도와 다음 초기화 시각을 한눈에 확인합니다.
- Non-goals: 기본 화면의 전체 응답 본문·토큰 통계·로그·SDK 숫자 표시.
- Success signals: 240×282에서 주요 정보가 스크롤 없이 보이고, 미제공 값이 0으로 표시되지 않습니다.

## Personas and jobs
- Primary personas: 현재 PC의 Codex 사용량과 작업 상태를 확인하는 사용자.
- User jobs: 계정 한도 확인, 여러 작업의 상태 확인, 선택한 응답 확인.
- Key contexts of use: 말을 할 수 없는 상황에서도 읽을 수 있는 상태창.

## Information architecture
- Primary navigation: 잔여량 중심 홈과 연결·진단 화면.
- Core routes/screens: 같은 Creation 안의 두 표시 영역.
- Content hierarchy: 계정 잔여 한도, 초기화, 세션 요약, 갱신 시각.
- 기본 가정: 잔여 한도 아래 전체 세션의 이름·상태를 표시합니다. 사용자 선호 질문의 답변에 따라 범위를 줄일 수 있습니다.

## Design principles
- 잔여 한도는 서비스가 반환한 사용 창·버킷 단위를 따릅니다.
- 응답 본문은 선택한 세션에서만 펼칩니다.
- 세션 연결이 미검증이면 목록·개수·상태를 만들어 표시하지 않습니다.
- Tradeoffs: 모든 세션의 전체 본문은 작은 화면에 동시에 담지 않습니다. 요약 목록을 우선합니다.

## Visual language
- Color: 기존 어두운 배경과 주황색 강조를 재사용합니다.
- Typography: 잔여 비율은 크게, 초기화·갱신은 작지만 읽기 쉽게 표시합니다.
- Spacing/layout rhythm: 8px 여백, 6px 간격.
- Shape/radius/elevation: 기존 5px 모서리, 그림자는 생략합니다.
- Motion: 별도 애니메이션을 사용하지 않습니다.
- Imagery/iconography: 비트맵·아이콘 패키지 없이 텍스트와 기본 막대만 사용합니다.

## Components
- Existing components to reuse: 연결 코드 폼, 진단 이벤트, 입력 시험 UI.
- New/changed components: 한도 카드, 상태 요약 영역, 갱신 표시, 연결·진단 이동 버튼.
- Variants and states: 조회 중, 실제 값, 조회 불가, 마지막 값, 연결 끊김.
- Token/component ownership: 기존 CSS와 프런트엔드 파일 안에서 관리합니다.

## Accessibility
- Target standard: 기본 키보드 조작과 명확한 대비.
- Keyboard/focus behavior: 화면 전환 버튼과 폼의 포커스 표시를 유지합니다.
- Contrast/readability: 색만으로 상태를 전달하지 않습니다.
- Screen-reader semantics: 한도 상태를 `output`·상태 문구로 제공합니다.
- Reduced motion and sensory considerations: 음성 안내·자동 소리·깜박임을 추가하지 않습니다.

## Responsive behavior
- Supported breakpoints/devices: r1 240×282, 일반 브라우저의 좁은 화면.
- Layout adaptations: 홈은 고정된 한 화면, 진단 화면만 세로 탐색합니다.
- Touch/hover differences: 터치 최소 높이 44px, hover에 의존하지 않습니다.

## Interaction states
- Loading: 사용 한도 확인 중.
- Empty: 미제공 또는 미검증 상태를 설명합니다.
- Error: 실제 값 없이 조회 실패를 표시합니다.
- Success: 출처가 확인된 계정 한도만 표시합니다.
- Disabled: 동일 대화 제어와 음성 자동 전송은 검증 전 차단합니다.
- Offline/slow network: 마지막 확인값과 연결 끊김을 구분합니다.

## Content voice
- Tone: 앱 안내는 정중한 문어체.
- Terminology: ‘계정 잔여 한도’, ‘초기화’, ‘세션 상태’.
- Microcopy rules: 구독 한도를 남은 토큰 수로 바꾸지 않습니다. 진단 세부 정보는 뒤로 숨깁니다.

## Implementation constraints
- Framework/styling system: 기존 HTML/CSS/JavaScript와 FastAPI.
- Design-token constraints: 새 디자인 체계·패키지를 추가하지 않습니다.
- Performance constraints: 화면은 데이터가 바뀔 때만 갱신하며 모델에 질문하지 않습니다.
- Compatibility constraints: r1에서 미지원인 `AbortSignal.timeout`을 사용하지 않습니다.
- Test/screenshot expectations: 실제 계정 조회 증거와 별도의 240×282 브라우저 검증을 남깁니다.
- 계정 조회는 별도 읽기 전용 app-server이며, 진행 중인 원래 Codex 세션 연결의 증거로 취급하지 않습니다.

## Open questions
- [ ] 기본 화면의 세션 표시 범위: 사용자 선호 응답을 반영합니다.
- [ ] 모든 실행 세션의 실시간 수집: 현재 `--no-daemon` 실행은 공유 서버 인계 승인과 별도 검증이 필요합니다.
- [ ] 한국어 음성 입력: 사용자가 발화할 수 있을 때 실기 검증합니다.
