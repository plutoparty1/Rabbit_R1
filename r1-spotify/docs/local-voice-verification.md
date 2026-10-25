# Local voice verification / 로컬 음성 검증

Date: 2026-10-25 (Asia/Seoul). Current source UI: `20261025-r27`; diagnostics: `20261025-r26-test`. Desktop timing rows below are historical r25 measurements.

The default flow is microphone → on-device Whisper → local command parsing / conservative text query → Spotify search/playback. No AI API key or running companion PC is required. The initial public model/runtime download and Spotify operations require internet access. This is not an integration with Rabbit's undocumented native speech recognizer.

기본 경로는 마이크 → 기기 내 Whisper → 기기 내 명령 해석 / 일반 문장 검색 → Spotify 검색·재생입니다. AI API 키나 켜 둔 PC가 필요하지 않습니다. 최초 공개 모델·실행 파일 다운로드와 Spotify 동작에는 인터넷이 필요합니다. 래빗 기본 음성 인식기에 직접 연결하는 구현은 아닙니다.

## Evidence and limits / 근거와 한계

| Check | Observation | What remains unproven |
| --- | --- | --- |
| User's r1: Rabbit AI connection | User reported success | Full recognition-to-playback flow |
| User's r1: browser speech | Listening indicator followed by timeout | Whether the browser recognition service can function on that WebView |
| User's r1: microphone-only capture | User reported 20,262 bytes collected, then audio discarded | Waveform quality, intelligible speech and local model performance |
| User's r1: local Whisper (r25) | Long recognition wait; “아이유의 밤편지 틀어줘” became “IU의 편벤지트로저” | Correct song retrieval and r26 device speed/accuracy |
| Desktop Edge: real Whisper model | WASM model ready in 7,834 ms | Initial load time on r1 or another network/cache state |
| Desktop Edge: synthetic Korean speech | Input “아이유의 밤편지 틀어 줘”; output “IU의 반편지 들어줘”; detected `ko`; 5,266 ms | Correct Korean song recognition; the title was wrong |
| Desktop Edge: synthetic English speech | Input “Play Yesterday by the Beatles”; output “Play yesterday by the Beatles.”; detected `en`; 4,483 ms | General English accuracy or real-device latency |
| Desktop Edge: real controller + WebM/Opus | 38,189-byte synthesized Korean recording decoded/resampled by the controller; output “IU의 반편지 들어죠”; detected `ko`; 4,913 ms | Real r1 microphone input, performance and correct song recognition |
| Isolated worker network observation | Zero non-GET requests during the real-model checks | The later Rabbit text and Spotify steps were not part of this test |

The desktop checks downloaded and executed the real model; they were not mocked recognition responses. Inputs were generated test speech, not a recording from r1. Timings are single observed runs, not performance guarantees. Two examples do not establish multilingual accuracy. Neither Rabbit text analysis nor real Spotify playback was exercised by the isolated worker test.

PC 시험은 모의 인식 응답 대신 실제 모델을 내려받아 실행했습니다. 입력은 합성 시험 음성이며 r1 녹음이 아닙니다. 시간은 한 번의 측정값으로 성능을 보장하지 않습니다. 한국어 결과는 곡명을 틀렸고 두 예문만으로 다국어 정확도를 평가할 수 없습니다. 이 Worker 단독 시험은 래빗 텍스트 분석이나 실제 Spotify 재생을 실행하지 않았습니다.

The r25 repository suite passed 125 tests. Main-player browser checks passed in Korean and English with zero voice uploads; diagnostic browser checks passed preparation, capture and cancellation at 240-pixel widths. These UI checks use controlled bridge/model responses. Automated controller/worker/voice tests cover preparation, cancellation, resource release, bounded input, error redaction, explicit/automatic language selection and result handling. They do not replace an r1 trial. Run `node --test tests/local-speech.test.mjs tests/local-asr-worker.test.mjs tests/voice.test.mjs` from `r1-spotify` for these unit checks.

## r27 direct search / 직접 검색

Validation: **151 automated tests passed**. Korean and English browser checks passed with no Rabbit bridge available, no Rabbit module import and no audio upload. The unstructured phrase “아이유 밤편지 틀어줘” becomes the Spotify query “아이유 밤편지”; mocked candidates require a selection. Physical button event handlers are unchanged. Real r1 recognition accuracy and live Spotify search results still require the device trial.

The user reported that the physical side button opened the voice panel without recording, then confirmed it worked again. Hardware event handlers are preserved; no firmware cause was established. A separate spoken request failed at Rabbit song parsing. r27 removes that dependency from the default player: explicit commands use structured search; other nonempty speech becomes a cleaned Spotify query and always requires candidate selection. The diagnostic page retains its separate Rabbit test. Raw transcription accuracy is unchanged.

사용자는 우측 물리 버튼이 음성 창만 열던 현상이 재시도 후 정상 동작한다고 확인했습니다. 물리 버튼 이벤트는 유지하며 펌웨어 원인을 확정하지 않았습니다. 남은 곡 분석 오류는 기본 재생 화면에서 래빗 AI 의존성을 제거해 처리합니다. 형식이 명확하지 않은 문장도 Spotify에서 검색하고 후보 선택을 기다립니다. 음성 받아쓰기 정확도 자체는 바뀌지 않았습니다.

## r26 changes / 변경 사항

Validation: the r26 repository suite passed **145 tests**. Main-player browser checks passed in Korean and English at 240×282 and 240×240, including cold physical-button capture, warm model reuse, cancellation and zero audio uploads. The separate diagnostic browser suite also passed. These UI checks use controlled model/Spotify responses; the timing comparison below executes the real model.

- Playback prepares the model in the background. A hold starts the microphone immediately, even while that preparation is pending. Closing an idle/recording panel preserves preparation; cancelling active inference terminates it.
- Short requests reuse one audio encoder result for fresh language classification and transcription. Audio beyond 30 seconds uses overlapping 25-second chunks through the supported pipeline, up to the 60-second safety cap.
- A controlled desktop Edge comparison used the same browser and pinned model, three repetitions each, excluding downloads. Korean baseline: 6,556 / 4,639 / 4,413 ms; optimized: 3,124 / 2,434 / 2,435 ms. English baseline: 4,541 / 4,442 / 4,363 ms; optimized: 2,409 / 2,370 / 2,364 ms. The second and third runs were about 46% faster. Output text and language were unchanged, including the Korean title error. These are desktop timings, not r1 measurements.
- A real 35-second test with speech only after 30 seconds retained that final phrase. Whisper also hallucinated “you” during the preceding silence, so extended silent recordings remain an accuracy limitation.
- Clear Korean/English command patterns are parsed locally before Rabbit text AI. Artist-catalog recovery returns selectable Spotify candidates when title searches fail. It does not repair the raw transcript or guarantee that the desired song is in the returned catalog page.

재생 화면의 준비 버튼을 없애고 다운로드와 녹음을 동시에 진행합니다. 동일 PC·브라우저에서 실제 모델로 비교한 두 번째·세 번째 실행은 약 46% 빨라졌지만, 한국어 곡명 오인식은 그대로였습니다. r1에서의 개선 폭과 곡명 복구는 추가 실기 확인이 필요합니다.

## Pinned implementation / 고정 구현

| Component | Configuration |
| --- | --- |
| Browser library | `@huggingface/transformers@3.8.1` |
| Runtime | Package-bundled ONNX Runtime Web; WASM CPU, `numThreads = 1`, `proxy = false`, dedicated Web Worker |
| Model | Multilingual `Xenova/whisper-tiny`, `dtype: 'q8'` |
| Model revision | `5332fcc35e32a33b86612b9a57a89be7906102b1` |
| Downloads | About 65 MB initially: 40.9 MB model weights, 21.6 MB WASM, plus JavaScript/tokenizer/configuration |
| Audio | Decode/resample locally to 16 kHz mono PCM, at most 60 seconds; no inference-service audio upload |
| Language | Explicit first-token Whisper classification when automatic mode is selected; then `task: 'transcribe'` with the detected language |
| Limits | At most 128 new tokens; bounded preparation/inference waits; worker termination on cancellation |

Transformers.js 3.8.1 defaults to English if language is omitted. The worker therefore implements Whisper's language-token classification explicitly instead of relying on that default. A language selection in diagnostics skips this extra classification pass. Language identification can still be wrong, particularly for brief or mixed-language speech.

Transformers.js 3.8.1은 언어를 생략하면 영어를 사용합니다. 따라서 Worker가 Whisper의 언어 토큰 분류를 직접 수행합니다. 진단에서 한국어 등 언어를 지정하면 이 추가 단계를 건너뜁니다. 짧거나 여러 언어가 섞인 발화에서는 언어 판단도 틀릴 수 있습니다.

Model files may be reused from the WebView cache; cache persistence is not guaranteed. Recordings/transcripts are not persisted by this implementation. In the player, all recognized requests are handled locally and sent to Spotify as artist/title or a cleaned text query; Rabbit AI is not called. Diagnostics send it only after pressing ③. Spotify login and the user's Client ID are needed for playback, but not for the diagnostic page.

모델 캐시 유지 여부는 WebView에 달려 있습니다. 구현은 녹음·인식 문장을 영구 저장하지 않습니다. 재생 화면에서는 모든 인식 요청을 기기에서 처리하고 가수·곡명 또는 정리한 검색 문장으로 Spotify에 보냅니다. 래빗 AI는 호출하지 않습니다. 진단에서는 ③을 누를 때만 보냅니다. 재생에는 Spotify 로그인·본인의 Client ID가 필요하며 진단에는 필요하지 않습니다.

## Next r1 trial / 다음 실기 시험

1. Open the updated diagnostic page and confirm `r26-test`. / 새 진단 페이지에서 `r26-test`를 확인합니다.
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

The main player now prepares automatically, records immediately on a hold even if preparation is incomplete, and ends recording on release (60-second stuck-button ceiling). The separate diagnostic page retains an explicit preparation control for isolating model loading.

재생 화면에서는 모델을 자동으로 준비하며, 준비 중이어도 누른 즉시 녹음을 시작하고 놓으면 끝냅니다. 버튼 오작동 보호 상한은 60초입니다. 별도 진단 화면에는 다운로드 단계를 확인하기 위한 준비 버튼을 유지합니다.

The retained Gemini module is a developer-only legacy option. The r25 default player does not call `/api/voice/config` or `/api/voice/search`; merely setting Gemini secrets does not select it.

남겨 둔 Gemini 모듈은 개발자용 이전 경로입니다. r25 기본 재생 화면은 `/api/voice/config`·`/api/voice/search`를 호출하지 않으며 비밀값 설정만으로 그 방식이 선택되지 않습니다.
