# Local voice verification / 로컬 음성 검증

Date: 2026-10-25 (Asia/Seoul). Source UI: `20261025-r25`; diagnostics: `20261025-r25-test`.

The default flow is microphone → on-device Whisper → Rabbit text AI → Spotify search/playback. No AI API key or running companion PC is required. The initial public model/runtime download, Rabbit text analysis and Spotify operations require internet access. This is not an integration with Rabbit's undocumented native speech recognizer.

기본 경로는 마이크 → 기기 내 Whisper → 래빗 텍스트 AI → Spotify 검색·재생입니다. AI API 키나 켜 둔 PC가 필요하지 않습니다. 최초 공개 모델·실행 파일 다운로드, 래빗 텍스트 분석, Spotify 동작에는 인터넷이 필요합니다. 래빗 기본 음성 인식기에 직접 연결하는 구현은 아닙니다.

## Evidence and limits / 근거와 한계

| Check | Observation | What remains unproven |
| --- | --- | --- |
| User's r1: Rabbit AI connection | User reported success | Full recognition-to-playback flow |
| User's r1: browser speech | Listening indicator followed by timeout | Whether the browser recognition service can function on that WebView |
| User's r1: microphone-only capture | User reported 20,262 bytes collected, then audio discarded | Waveform quality, intelligible speech and local model performance |
| Desktop Edge: real Whisper model | WASM model ready in 7,834 ms | Initial load time on r1 or another network/cache state |
| Desktop Edge: synthetic Korean speech | Input “아이유의 밤편지 틀어 줘”; output “IU의 반편지 들어줘”; detected `ko`; 5,266 ms | Correct Korean song recognition; the title was wrong |
| Desktop Edge: synthetic English speech | Input “Play Yesterday by the Beatles”; output “Play yesterday by the Beatles.”; detected `en`; 4,483 ms | General English accuracy or real-device latency |
| Desktop Edge: real controller + WebM/Opus | 38,189-byte synthesized Korean recording decoded/resampled by the controller; output “IU의 반편지 들어죠”; detected `ko`; 4,913 ms | Real r1 microphone input, performance and correct song recognition |
| Isolated worker network observation | Zero non-GET requests during the real-model checks | The later Rabbit text and Spotify steps were not part of this test |

The desktop checks downloaded and executed the real model; they were not mocked recognition responses. Inputs were generated test speech, not a recording from r1. Timings are single observed runs, not performance guarantees. Two examples do not establish multilingual accuracy. Neither Rabbit text analysis nor real Spotify playback was exercised by the isolated worker test.

PC 시험은 모의 인식 응답 대신 실제 모델을 내려받아 실행했습니다. 입력은 합성 시험 음성이며 r1 녹음이 아닙니다. 시간은 한 번의 측정값으로 성능을 보장하지 않습니다. 한국어 결과는 곡명을 틀렸고 두 예문만으로 다국어 정확도를 평가할 수 없습니다. 이 Worker 단독 시험은 래빗 텍스트 분석이나 실제 Spotify 재생을 실행하지 않았습니다.

The full repository suite passed 125 tests. Main-player browser checks passed in Korean and English with zero voice uploads; diagnostic browser checks passed preparation, capture and cancellation at 240-pixel widths. These UI checks use controlled bridge/model responses. Automated controller/worker/voice tests cover preparation, cancellation, resource release, bounded input, error redaction, explicit/automatic language selection and result handling. They do not replace an r1 trial. Run `node --test tests/local-speech.test.mjs tests/local-asr-worker.test.mjs tests/voice.test.mjs` from `r1-spotify` for these unit checks.

## Pinned implementation / 고정 구현

| Component | Configuration |
| --- | --- |
| Browser library | `@huggingface/transformers@3.8.1` |
| Runtime | Package-bundled ONNX Runtime Web; WASM CPU, `numThreads = 1`, `proxy = false`, dedicated Web Worker |
| Model | Multilingual `Xenova/whisper-tiny`, `dtype: 'q8'` |
| Model revision | `5332fcc35e32a33b86612b9a57a89be7906102b1` |
| Downloads | About 65 MB initially: 40.9 MB model weights, 21.6 MB WASM, plus JavaScript/tokenizer/configuration |
| Audio | Decode/resample locally to 16 kHz mono PCM, at most 15 seconds; no inference-service audio upload |
| Language | Explicit first-token Whisper classification when automatic mode is selected; then `task: 'transcribe'` with the detected language |
| Limits | At most 128 new tokens; bounded preparation/inference waits; worker termination on cancellation |

Transformers.js 3.8.1 defaults to English if language is omitted. The worker therefore implements Whisper's language-token classification explicitly instead of relying on that default. A language selection in diagnostics skips this extra classification pass. Language identification can still be wrong, particularly for brief or mixed-language speech.

Transformers.js 3.8.1은 언어를 생략하면 영어를 사용합니다. 따라서 Worker가 Whisper의 언어 토큰 분류를 직접 수행합니다. 진단에서 한국어 등 언어를 지정하면 이 추가 단계를 건너뜁니다. 짧거나 여러 언어가 섞인 발화에서는 언어 판단도 틀릴 수 있습니다.

Model files may be reused from the WebView cache; cache persistence is not guaranteed. Recordings/transcripts are not persisted by this implementation. In the player, the recognized transcript goes to Rabbit's documented text bridge for artist/title extraction. Diagnostics send it only after pressing ③. Spotify login and the user's Client ID are needed for playback, but not for the diagnostic page.

모델 캐시 유지 여부는 WebView에 달려 있습니다. 구현은 녹음·인식 문장을 영구 저장하지 않습니다. 재생 화면에서는 인식 문장을 공식 래빗 텍스트 채널에 보내 가수·곡명을 추출합니다. 진단에서는 ③을 누를 때만 보냅니다. 재생에는 Spotify 로그인·본인의 Client ID가 필요하며 진단에는 필요하지 않습니다.

## Next r1 trial / 다음 실기 시험

1. Open the updated diagnostic page and confirm `r25-test`. / 새 진단 페이지에서 `r25-test`를 확인합니다.
2. Keep local Whisper selected, press **음성 인식 준비**, and wait until ready. / 로컬 Whisper에서 준비를 누르고 완료될 때까지 기다립니다.
3. Hold the screen or side button, speak for 3–5 seconds, release, and check the transcript. / 버튼을 누른 채 3~5초 말하고 놓은 뒤 문장을 확인합니다.
4. Press ③ only after a transcript appears; report the stage/error code or copy the diagnostic result. / 문장이 나온 뒤 ③을 누르고 단계·오류 코드 또는 진단 결과를 공유합니다.

A successful transcript establishes only the tested device/language/request. Confirm the extracted artist/title and playback separately. Incorrect proper names must remain visible as a limitation; a successful language code is not a correct song result.

## Alternatives and sources / 대안과 근거

- [Transformers.js pipeline documentation](https://huggingface.co/docs/transformers.js/v3.8.1/en/pipelines) and [pinned model files](https://huggingface.co/Xenova/whisper-tiny/tree/5332fcc35e32a33b86612b9a57a89be7906102b1): selected implementation, running locally in the browser.
- [Whisper language detection source](https://github.com/openai/whisper/blob/main/whisper/decoding.py): first-token classification over language tokens, followed by same-language transcription.
- [ONNX Runtime browser support](https://onnxruntime.ai/docs/get-started/with-javascript/web.html#supported-versions) and [thread configuration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html): Android Chrome/Edge WASM support and single-thread operation without cross-origin-isolated threading. This is not an r1 certification.
- [Rabbit Creation text bridge](https://github.com/rabbit-hmi-oss/creations-sdk/blob/main/plugin-demo/reference/creation-triggers.md): documented text AI integration; no invented native audio API.
- [whisper.cpp browser example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/whisper.wasm): considered, not implemented. Its default build uses pthreads and needs a different integration/build configuration.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper): considered, not implemented. It can run without a paid AI API key but requires a Python host/PC/server; that is an additional dependency for this Creation.

The retained Gemini module is a developer-only legacy option. The r25 default player does not call `/api/voice/config` or `/api/voice/search`; merely setting Gemini secrets does not select it.

남겨 둔 Gemini 모듈은 개발자용 이전 경로입니다. r25 기본 재생 화면은 `/api/voice/config`·`/api/voice/search`를 호출하지 않으며 비밀값 설정만으로 그 방식이 선택되지 않습니다.
