<p align="center"><img src="docs/assets/logo.svg" width="64" alt="R1 Spotify project logo" /></p>

<p align="center"><strong>English</strong> · <a href="README.ko.md">한국어</a></p>

![R1 Spotify — your music, a little closer](docs/assets/hero.svg)

<p align="center"><img alt="Platform: rabbit r1" src="https://img.shields.io/badge/platform-rabbit_r1-ff6333?style=flat-square" /> <img alt="Auth: OAuth PKCE" src="https://img.shields.io/badge/auth-OAuth_PKCE-a4ffba?style=flat-square" /> <img alt="Runtime: JavaScript and Worker" src="https://img.shields.io/badge/runtime-JavaScript_%2B_Worker-24392e?style=flat-square" /> <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-a4ffba?style=flat-square" /></a></p>

# R1 Spotify

**An open-source Spotify remote for rabbit r1. Build it, host it, make it yours.**

See the artwork, track, artist, album and playback progress. Swipe to skip, press the side button to pause, and turn the wheel for volume. The Creation runs on r1 without a companion PC; audio continues on the active phone, computer or speaker signed in to the same Spotify account.

[Get started](#get-started) · [Controls](#controls) · [Voice requests](#voice-requests) · [Self-host](#self-host) · [Privacy](#privacy-and-authentication) · [Troubleshooting](#troubleshooting) · [Verification](#verification)

> Open-source under MIT. Open the hosted app, enter your own Spotify Client ID once, then sign in. Self-hosting is optional for developers. Playback control requires Spotify Premium, app account access and an active playback device.

## Built for a small screen

| Capability | What you get |
| --- | --- |
| Hardware-first control | Side-button play/pause; wheel volume in 5% steps; artwork swipe for previous/next |
| Multilingual voice requests | Hold the side button, say an artist and song, then release to search; requires voice service configuration and deployment |
| Focused lyrics | Tap artwork to open lyrics; scroll with the wheel; follow the current line when timestamps exist |
| Multiple lyric sources | Bugs first, then LRCLIB exact/search and lyrics.ovh fallback |
| Session recovery | PKCE login, token refresh and on-device session restoration |
| Resilient playback state | Approximately 3-second foreground polling, interpolated progress and rate-limit backoff |
| Compact layout | Short viewport handling, bottom spacing and device diagnostics |

## Preview

<table><tr><th>Now playing</th><th>Lyrics focus</th><th>Follow controls</th></tr><tr><td><img src="docs/previews/sior-night-player-full-en.png" width="240" alt="Album artwork and playback controls" /></td><td><img src="docs/previews/sior-night-lyrics-full-en.png" width="240" alt="Lyrics-only view" /></td><td><img src="docs/previews/sior-night-controls-full-en.png" width="240" alt="Lyrics follow checkbox" /></td></tr></table>

English UI previews feature **Sing the Night** by **Sior**, from **Distorted Gaze** (metadata translated for the preview). Track information, artwork and original Korean lyrics: [Bugs](https://music.bugs.co.kr/track/32794635). Playback state is mocked. At the song owner’s request, the preview loads all 42 lines returned by Bugs and fills the visible lyrics viewport with actual lyrics; the remaining lines are scrollable. The UI is English and the original Korean lyrics remain untranslated.

## Get started

Use the **hosted app with your own Spotify Client ID**. You do not need a server deployment or an invitation to the repository owner's Spotify app. After setup, My device restores your connection; Shared device signs in for this page only.

### What you need

- A rabbit r1 with access to add a Creation
- Your own Spotify Premium account
- A phone or computer for Spotify developer setup
- A phone, computer or speaker playing Spotify on that same account

### 1. Add the app to Creation

Register the [hosted R1 Spotify URL](https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/) as your rabbit Creation launch URL. The QR below points to that same URL; it does not issue a Client ID or connect your account.

<p align="center"><img src="docs/install-qr.png" width="180" alt="R1 Spotify launch URL QR" /></p>

The [Creation configuration](docs/install-creation.json) also contains the launch information. Users do not need to download source or deploy a server.

### 2. Create your own Spotify developer app

On a phone or computer, open [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Sign in with **the Premium account you will use**, then select **Create app**.

| Field | Example |
| --- | --- |
| App name | My R1 Spotify |
| App description | Personal Spotify remote for my rabbit r1 |
| Website (if requested) | `https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/` |
| API/SDK selection (if shown) | Web API |
| Redirect URI | The exact address in step 3 below |

Review the developer terms and create the app. Dashboard labels and placement may change; see [Spotify's official app setup guide](https://developer.spotify.com/documentation/web-api/concepts/apps).

### 3. Register the Redirect URI

In your Spotify app, open **Settings → Redirect URIs**, add the following address, and **Save**. If you entered it while creating the app, check the saved value.

```text
https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/
```

**Match the trailing `/` too.** R1 Spotify's connection screen shows its current address with a copy button. For another deployment, register the address shown there. Do not use the GitHub repository URL as your Redirect URI.

### 4. Send your Client ID from your phone and log in

1. On r1, choose **Set up with phone · QR / code**.
2. Scan the QR **with your phone camera**. The phone setup page opens with the code filled in.
3. On your phone or computer, copy the 32-character **Client ID** from your own Spotify app's **Settings**, paste it into the setup page, and select **Send to r1**.
4. Compare the last 8 characters on both screens, then choose **Use this Client ID** on r1.
5. Choose **My device** or **Shared device**, then select **Save Client ID and log in** on r1. Sign in and grant Spotify access there.
6. Play music on another device using the same Spotify account.

**Cannot scan?** Open the [phone setup page](https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/pair.html) on your phone/PC and enter the 8-character code shown on r1. Codes expire after 10 minutes. Select **Create a new code** if expired, already used, or sent by the wrong person. Direct Client ID entry remains available.

**No Client Secret is needed or accepted.** The QR contains only a temporary connection code. It carries no Client ID or Spotify login token. The relay sends only your public Client ID; Spotify login stays on r1. Applying a received ID does not change an existing connection until you explicitly log in.

### Choose My device or Shared device

Choose a login retention mode above the Client ID field.

| Choice | Credential storage | When reopened |
| --- | --- | --- |
| My device · keep me signed in | rabbit secure storage and IndexedDB | Restores the saved login |
| Shared device · this visit only | Tokens remain in the current page's memory only | Login required after reload or reopening |

Changing modes disconnects and removes saved tokens. Shared-mode OAuth preparation is kept only in the same tab's sessionStorage and cleared after completion. A device that returns OAuth in a completely new WebView may therefore be unable to finish shared-mode login. The non-secret mode preference is retained. Disconnect when finished; sign out on Spotify too if you need to end Spotify's own browser login. This app cannot delete Spotify website cookies.

### If connection fails

| Symptom | Action |
| --- | --- |
| Invalid Client ID | Use the 32-character Client ID from Settings, not the Client Secret. |
| INVALID_CLIENT / redirect error | Check your app's Redirect URI against the launch app's displayed address, including the trailing slash. |
| 403 / playback permission denied after login | Check account access in **your own app's** Users Management; if needed, add your name and Spotify email with Add new user. Also check Premium and device restrictions. |
| Signed in but no track appears | Start playback on a phone, computer or speaker using the same account. |
| Previously used the shared ID | Only implicit legacy defaults are disconnected. Explicitly configured IDs are retained, including the original app owner’s ID. Use the saved-ID recovery button to fill a previous ID, then log in. |

Spotify development-mode user and request limits apply to **each user's own Spotify app**. Users of this project do not share a single Client ID. App creation eligibility and account requirements remain subject to Spotify policy. [Official quota policy](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)

## Controls

| Screen | Input | Action |
| --- | --- | --- |
| Player | Swipe artwork left / right | Next / previous track |
| Player | Press r1 side button once | Play / pause |
| Player / Lyrics | Hold r1 side button, speak, then release | Record and search Spotify by artist and song; automatically play a unique exact match or choose a result |
| Player | Voice search button | Open the voice panel; hold its recording button with touch, Space or Enter, and release to submit |
| Player | Wheel up / down | Volume +5% / −5%, within 0–100%, if supported by the active device |
| Player | Tap artwork | Open lyrics |
| Lyrics | Wheel or touch scroll | Explore freely; turns off automatic following |
| Lyrics | Tap, or press Enter | Reveal controls; another tap hides them; auto-hide after 3 seconds |
| Lyrics | Enable “현재 가사 따라가기” | Jump to and follow the current timed line |
| Lyrics | Swipe left / right, or Escape | Return to player without skipping tracks |
| Menu | Three dots | Connection settings, disconnect, help and device diagnostics |

Tapping lyrics preserves follow mode. Checkbox interaction restarts the controls timer. Plain lyrics have no timed follow mode. Vertical drags, short touches and cancelled gestures do not close lyrics. The app follows the WebView language for Korean/English UI; original lyrics are not translated.

## Voice requests

### Test on r1 without an API key

The [rabbit voice diagnostic page](https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/rabbit-test.html) needs **no Spotify login or Gemini key**. Open **Test rabbit voice without an API key** in the existing Creation's connection settings, or register the diagnostic URL as a Creation launch URL. Rabbit AI may be unavailable in a desktop or phone browser. The diagnostic UI is in Korean.

1. Run **래빗 AI 연결 확인** to extract artist/title from a fixed example using Rabbit's text LLM channel.
2. Select speech recognition and Korean, hold the side button, wait for the listening indicator, say **“아이유의 밤편지 틀어줘”**, then release. If you released while waiting for microphone permission, grant it and hold again. An on-screen hold button is also available.
3. Check the transcript, then select **인식 문장 분석** to send it to Rabbit AI and inspect the artist/title.
4. If recognition fails, try microphone-only recording to distinguish microphone access from recognition-service availability. Copy the report or share the displayed status/error codes.

Recognition here uses the Web Speech API; it does not establish access to Rabbit's native speech recognizer. Browser default means the browser's default language, **not guaranteed automatic language detection**. Test English, Japanese and default separately after Korean works. API presence alone is not a pass: a real transcript and successful Rabbit analysis of that transcript are needed to verify this keyless path on the tested device/language. Automatic multilingual recognition and end-to-end Spotify voice playback remain separate tests.

Speech may be sent to the browser vendor's recognition service. Only an explicit button press sends the example or recognized text to Rabbit; speaker output and journal logging are not requested. Microphone-only mode discards audio and records only byte count and format. Copied reports exclude spoken text, raw AI replies and credentials. Cancel/page exit stops capture and invalidates late results; an already dispatched Rabbit server request cannot be recalled.

Diagnostic version: `20261025-r24-test`. It uses the [documented Rabbit SDK](https://github.com/rabbit-hmi-oss/creations-sdk/blob/main/plugin-demo/reference/creation-triggers.md) text LLM channel, without guessing undocumented native audio APIs. An r23 device trial reported a timeout and a listening indicator, but no final transcript or per-stage report was available to establish the failing stage. Automated checks simulate speech and Rabbit replies; they do not establish device success.

After a timeout, check the new version label and retry with the **on-screen hold button** to compare against the physical side button. Recognition now captures one utterance at a time. A recognizer start event alone does not prove microphone input, detected speech or a transcript; the screen and report distinguish these events. Stage ③ cannot run without a final transcript. If recognition still fails, try **microphone recording only**, then share the stage, error code and last observed event, or copy the diagnostic report. Additional report fields contain only event names, counts and elapsed times.

| Error code | Observed condition |
| --- | --- |
| `speech_start_timeout` | No recognition start event within 15 seconds |
| `speech_result_timeout` | No final transcript or end event within 8 seconds after requesting stop |
| `speech_interim_only` | Interim text arrived, but no final transcript was received |
| `rabbit_no_response` | No Rabbit callback within 45 seconds |
| `rabbit_unmatched_response` | A callback arrived, but no analysis matching the current request was found |

Rabbit replies are checked in both documented `data` and `message` fields. Request ID matching remains required so a late reply from an earlier request cannot pass a new test. These timeout and diagnostic changes do not establish that a device's speech service issue has been resolved.

### Request songs with server speech recognition

The source includes push-to-talk search for the open Creation's player and lyrics screens. It needs a configured voice backend and an updated deployment; a GitHub update alone does not enable it on the public app. Existing playback controls work without voice configuration. Recording and the full recognition-to-playback flow still need verification on a real r1.

**Already signed in before this update? Reconnect and sign in once** to grant the added `user-read-private` permission used by Spotify search and `/v1/me` identity verification. Refreshing an existing token cannot add OAuth permissions. See [Spotify's scope reference](https://developer.spotify.com/documentation/web-api/concepts/scopes).

1. Sign in to Spotify, start playback on your phone, computer or speaker, and open the player or lyrics screen on r1.
2. Hold the side button and allow microphone access when prompted. Speak after the recording indicator appears, then release the button. If you released while permission was pending, hold again after allowing access.
3. The app sends the recording for language detection and song extraction, then searches Spotify. One exact title-and-artist match plays automatically; otherwise, choose from up to five candidates.

Example requests: **“아이유의 밤편지 틀어줘”**, **“Play Yesterday by The Beatles”**, or **“테일러 스위프트의 Cruel Summer 틀어줘.”** No language selector is required. The voice service keeps song and artist names in their spoken form instead of translating them. Short utterances, pronunciation, aliases and mixed-language names can still produce a wrong transcription or multiple results; check the displayed candidates when a match is uncertain.

The player's **Voice search** button opens the same panel. Hold its recording button by touch or with Space/Enter, then release to submit. Recording automatically submits at 15 seconds; a recording over 2 MiB is rejected. Cancelling, hiding or leaving the app, changing screens, or disconnecting cancels pending voice work.

Only an open Creation receives these button events. Voice requests control the active Spotify device and do not stream music through r1. The operator must enable voice access for your Spotify user ID separately from your Spotify developer app's user access.

## How it works

![Device, Spotify playback and lyrics data flow](docs/assets/architecture.svg)

The browser calls Spotify directly for authentication, search and playback control. A same-origin Worker serves the UI and the Bugs lyrics endpoint. The optional voice endpoint verifies the caller with Spotify, then sends recorded audio to Gemini for transcription, language detection and artist/title extraction. Spotify search and playback remain in the browser. LRCLIB and lyrics.ovh are browser fallbacks. This project controls an existing Spotify player; it does not stream audio to r1.

### Lyrics lookup

Bugs matching checks title, artist aliases and a duration difference of at most 2 seconds, prefers the same album, and examines at most three deduplicated candidates. Version names are retained; English titles are not automatically translated into Korean. Bugs returns plain lyrics. If unavailable, the client tries LRCLIB exact lookup and search, then lyrics.ovh. Tap the lyrics view to see the actual provider.

Bugs server lookup has a 20-second budget; the browser waits up to 25 seconds. Successful responses can be reused by the device for 5 minutes. Provider availability, coverage and public page structure may change.

## Hosting

The public app remains on its existing Sites hosting. It is not being migrated to Cloudflare. The self-hosting instructions below are optional for developers operating an independent fork.

## Self-host

Optional for developers and independent operators. Prepare Git, Node.js 24 with npm, an HTTPS hosting account and your own Spotify Web API app.

```powershell
git clone https://github.com/plutoparty1/Rabbit_R1.git
cd Rabbit_R1/r1-spotify
```

After deployment, register your exact HTTPS Redirect URI in Spotify Dashboard and enter your Client ID in connection settings. Update the [installation template](docs/install-creation.example.json) and rabbit Creation launch URL to your own deployment.


The frontend and server build without application package installation. `npx` downloads Wrangler when needed. Run these commands from `r1-spotify`:

```powershell
node scripts/build.mjs
npx wrangler login
npx wrangler deploy --config wrangler.jsonc
```

The [Wrangler example](wrangler.jsonc) uses the generated `dist/server/index.js` entry point and runs the build before deployment. Change `name` if desired and deploy through your own Cloudflare account. Register the HTTPS URL printed by the CLI in Spotify and rabbit Creation. See the [Cloudflare configuration reference](https://developers.cloudflare.com/workers/wrangler/configuration/) for configuration details.

To preview the frontend and server locally:

```powershell
node scripts/build.mjs
npx wrangler dev --config wrangler.jsonc --port 8791
```

The local address is for development. Use your deployed HTTPS URL for r1 installation and actual Spotify login. Rebuild after frontend edits. The build bundles the existing `dist` UI and server modules into the Worker. Other hosting must support the same module Worker interface, `/api/lyrics/bugs` and, when enabled, `POST /api/voice/search`.

### Enable voice requests

Configure the following on the deployment's server, then rebuild and deploy the updated source. Users do not enter a Gemini key on r1. Keep the existing Sites hosting when updating the public instance; the Wrangler commands above apply only to an independently hosted fork.

| Server setting | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Required server secret for the Gemini API; never include it in frontend files, a Git commit or a public configuration file |
| `VOICE_ALLOWED_SPOTIFY_USERS` | Required comma-separated Spotify **user IDs** from `GET https://api.spotify.com/v1/me`: prefer immutable `account_id`, or use `id`; these are neither emails nor Client IDs |
| `VOICE_MODEL` | Optional Gemini model override; defaults to `gemini-3.8-flash`. Use a model available to your project that supports audio input and structured JSON output |

For an independent Wrangler deployment, set the API key with `npx wrangler secret put GEMINI_API_KEY --config wrangler.jsonc`. Add `VOICE_ALLOWED_SPOTIFY_USERS` and an optional `VOICE_MODEL` to the deployment's environment variables. For local development, use an untracked `.dev.vars` file with those same names. Do not commit real keys or user IDs.

The voice endpoint accepts the current Spotify access token in the Authorization header, verifies it against Spotify's `/v1/me`, and checks the user ID against the server allowlist before calling Gemini. It does not accept anonymous voice requests. `GET /api/voice/config` reports whether the required server settings are present; it does not test provider credentials. Missing voice configuration leaves basic playback available and causes voice requests to report that the service is unavailable.

Each Spotify identity is limited to 6 requests per minute, 60 per hour, and one active request **per warm Worker isolate**. These in-memory limits are not global quotas across instances or restarts. Configure provider spending/usage limits or a shared gateway quota for broader deployments. Spotify verification has an 8-second timeout and Gemini a 25-second timeout; paid inference is not automatically retried. The endpoint accepts at most 2 MiB of decoded audio in a 3 MiB JSON request. Audio formats include WebM, Ogg, WAV, MP3/MPEG, AAC, FLAC, M4A and Opus; MP4 audio is normalized to M4A for the provider.

The implementation uses Gemini's [audio input](https://ai.google.dev/gemini-api/docs/audio) and [generateContent API](https://ai.google.dev/api/generate-content); check [model availability](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) for your project before deployment.

### Sharing the project

- **Help others use the app:** Share the hosted app URL or QR and the quick-start instructions.
- **Share your modifications:** Publish your fork and retain the MIT copyright and license notice.
- **Operate a shared instance:** The operator manages hosting; each user registers and uses their own Spotify app as described above.

Spotify development-mode limits apply to **each Spotify app**, not to how many people may fork or download the source. As checked on 2026-10-18, the app owner needs Premium and each app supports up to five authenticated, allowlisted users. Serving a larger audience with one Client ID requires separate extended quota approval. Check the [official Spotify policy](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) for current conditions.

## Privacy and authentication

The hosted app controls playback using each user's own Client ID and Spotify login, without sharing the repository owner's Spotify account. On 2026-10-18, the old server-side lyrics bridge URL and authentication key were removed and the app redeployed. Public lyric providers supply fallback lyrics without a personal Spotify session. Hosting remains under the operator's Sites account. Disconnect before another person uses the same device/browser.

| Data | Handling |
| --- | --- |
| Access and refresh tokens | My device: native secure storage plus IndexedDB; Shared device: page memory only; not localStorage. Voice requests temporarily send the access token to the site server for Spotify identity verification; the server does not persist it. Refresh tokens stay on the device and are sent only to Spotify |
| Pending OAuth transaction | My device: localStorage; Shared device: same-tab sessionStorage; 10-minute expiry, one-time state and PKCE verifier; removed on completion, disconnect or expiry checks |
| Client ID | Public identifier only; localStorage for My device, same-tab sessionStorage for Shared device |
| Phone setup relay | Public Client ID, receiver-proof hash and expiry temporarily in Sites storage; no Spotify credentials. Received/cancelled sessions are deleted. Expired sessions cannot be used and abandoned records are pruned during new-session creation. |
| Bugs request | Track title, artist, album and duration only; no Spotify token |
| Other lyrics requests | Track metadata sent to the selected provider; no Spotify credentials |
| Voice request | Audio is sent to the site server and Gemini; Spotify credentials are not sent to Gemini. The app does not persist or log recordings or transcripts. Provider processing and retention are governed by the operator's Gemini service settings and terms |

IndexedDB is browser storage, not a hardware-encrypted vault. The backup remains because a native storage success response may not guarantee persistence. Secure storage initialization is retried for a bounded time; persistent storage must be confirmed before the app reports that login will survive reopening.

Disconnect removes saved credentials and records a logout marker to block restoration from stale native storage. Clearing browser data, blocked storage or revoked Spotify permission may require login again. Disconnect before handing a shared device/profile to another person. OAuth callback codes are removed from the address; do not put tokens, credentials or authorization codes in issues, screenshots, QR codes or logs.

## Troubleshooting

| Symptom | Check or action |
| --- | --- |
| An old link asks for ChatGPT login | Use your own Worker deployment URL registered in your Creation |
| OAuth redirect error | Match the exact HTTPS URI, including trailing slash, in the Dashboard |
| Login succeeds; controls return 403 | Check the allowlist, Premium account and playback-device restrictions |
| No current track | Start Spotify playback on another device with the same account |
| Volume does not change | Inspect device diagnostics; remote volume support depends on the active device, not merely its operating system |
| Lyrics do not follow | Check whether the provider returned timestamps, then enable the follow checkbox |
| Lyrics are missing | Check connectivity and provider availability; mismatched title/version/duration can prevent a match |
| Login is lost after reopening | Inspect storage diagnostics; reconnect if storage was cleared, blocked or authorization revoked |
| Rate limited / offline | The app respects Retry-After and labels last-known data; avoid repeated manual commands |
| Old or cropped UI after returning | Check the displayed version and viewport in diagnostics; compare deployment assets with source |
| Voice service unavailable / access denied | Operator must deploy the updated code, configure the Gemini secret and allowlist your Spotify user ID; refresh the Spotify login if its access token expired |
| Existing login needs search permission | Reconnect and sign in once to grant `user-read-private`; token refresh alone does not add this permission |
| Microphone denied or unsupported | Allow microphone access and use an HTTPS URL; check the current r1 WebView's recording support |
| Voice request finds the wrong song or multiple songs | Say both artist and title clearly, then inspect the candidate list; proper names and language detection can be misrecognized |
| Voice recognized but playback fails | Start Spotify on another device with the same account; check Premium, device restrictions and Spotify access |

Foreground polling pauses while the app is hidden. Resume signals are coalesced, viewport size is rechecked, stale responses and queued volume input are invalidated, and displayed lyrics/free-scroll position are retained where possible. Failed skip commands are not blindly retried.

## Full lyrics and scrolling

The live view renders every returned paragraph rather than a fixed excerpt. Use the wheel or touch to scroll; the bottom hint changes to End of lyrics at the final paragraph. Provider line endings are normalized. Plain lyrics have no synchronized following; missing provider content cannot be reconstructed by the app. A static preview shows only its visible viewport. The browser regression test checks all 120 synthetic paragraphs and the final scroll position.

## Development

```text
r1-spotify/
├── dist/                 HTML, CSS and browser ES modules (frontend source)
├── server/               Worker entry, Bugs lookup and optional voice service
├── scripts/build.mjs     Embeds UI and generates dist/server/
├── tests/                Node tests and Playwright callback scenarios
├── docs/                 Installation, screenshots, evidence and SVG assets
├── wrangler.jsonc Deployment configuration example
├── LICENSE               MIT license for r1-spotify
└── DESIGN.md             UI design notes
```

### Verification

```powershell
node scripts/build.mjs
node --test tests/*.test.mjs
node --check dist/app.mjs
node --check dist/spotify.mjs
```

Node tests cover core logic, OAuth, Spotify, lyric matching, Bugs, voice recording/selection and Worker responses. The `tests/*-check.js` files are Playwright callback functions, not standalone Node test commands. Serve `dist` at `http://127.0.0.1:8791/`, then invoke each callback with a Playwright Page. Most scenarios mock Spotify and lyric responses; `bugs-browser-check.js` uses live Bugs lookup with mocked playback. No lint/typecheck configuration is included.

| Evidence | Scope and limits |
| --- | --- |
| Node suite | Reproducible automated logic checks; does not prove hardware behavior |
| Recorded browser scenarios | 240×282 and smaller viewports, gestures, wheel, follow controls, authentication recovery, volume and resume |
| r22 voice browser scenarios | English/Korean Edge at 240×282 and 240×240: automatic playback, candidate selection, cancellation, errors and unconfigured service; microphone, recognition and Spotify responses are mocked |
| Historical r6 user report | Login retention, wheel input, manual/follow lyrics and visible playback buttons |
| Pending | Latest WebView end-to-end behavior, r7 tap controls on hardware, full multi-user sharing flow and device-specific volume; real r1 microphone permissions/recording, live multilingual recognition and voice-triggered Spotify playback |

The source UI identifies itself as `20261025-r24`. Check your own deployed version in device diagnostics. The voice feature's source update does not confirm a live-host deployment or a successful real-device/provider test. [verification.json](docs/verification.json) is historical evidence dated 2026-10-08, not a new certification. Detailed Korean implementation and test notes are preserved in the [original documentation archive](docs/archive/README.2026-10-18.ko.md).

## License

Code and original documentation/SVG assets in `r1-spotify/` are available under the [MIT license](LICENSE). You may use, modify, copy, redistribute and use them commercially while retaining the copyright and license notice. This license does not apply to sibling projects. Third-party services, trademarks, album art and lyrics remain subject to their owners' rights and are not covered by this MIT grant.

## Typography

Latin text uses [Inter](https://rsms.me/inter/); Korean uses [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR). Both are distributed under the SIL Open Font License, with [license notices](dist/fonts) included. Font files are served from the app itself, without runtime requests to Google Fonts. These fonts apply to the app and screenshots; GitHub controls the README body font.

## Contributing

1. Fork the repository and create a working branch.
2. Edit the frontend in `dist/` and server code in `server/`.
3. Run the build and relevant tests, and verify the changed behavior.
4. Update English and Korean docs together; open a pull request describing the change and validation.

## Support and references

Report problems in [GitHub Issues](https://github.com/plutoparty1/Rabbit_R1/issues) with the displayed version, device/WebView, viewport, playback device, reproduction steps and redacted diagnostics. Keep documentation changes aligned across English and Korean; label mock captures and separate hardware reports from automated checks.

- [Spotify playback state](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback), [volume control](https://developer.spotify.com/documentation/web-api/reference/set-volume-for-users-playback) and [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [rabbit hardware events and secure storage](https://github.com/rabbit-hmi-oss/creations-sdk/blob/main/plugin-demo/reference/creation-triggers.md)
- [LRCLIB](https://lrclib.net/docs) and [lyrics.ovh](https://github.com/NTag/lyrics.ovh#api)

Original SVG project mark, hero and architecture assets live in [docs/assets](docs/assets). The illustrated device is a concept graphic. Spotify and rabbit names belong to their respective owners; this community project is not affiliated with or endorsed by either company. Visual hierarchy was informed by [jev-gate](https://github.com/MongLong0214/jev-gate); its assets were not copied.

### Phone setup hosting

The existing Sites host provides the relay through an R2 binding named `PAIRING`; no new hosting account is required for users. The host remains unchanged. Eight-character random codes expire after 10 minutes, submissions are one-time, and only the originating device can retrieve a Client ID using its separate 256-bit receiver secret. Same-origin checks, bounded request bodies and per-IP rate limits protect relay endpoints. The QR renderer is vendored locally under MIT; no external QR service receives the URL.

For an optional self-hosted deployment, bind an R2 bucket as `PAIRING` in your Worker configuration. The included Wrangler example declares this binding; create a bucket and replace the example bucket name. Without storage, direct entry and login still work, and phone setup reports that it is unavailable. [QR library license](docs/licenses/qrcode-generator-LICENSE.txt).
