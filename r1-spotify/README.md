<p align="center"><img src="docs/assets/logo.svg" width="64" alt="R1 Spotify project logo" /></p>

<p align="center"><strong>English</strong> · <a href="README.ko.md">한국어</a></p>

![R1 Spotify — your music, a little closer](docs/assets/hero.svg)

<p align="center"><img alt="Platform: rabbit r1" src="https://img.shields.io/badge/platform-rabbit_r1-ff6333?style=flat-square" /> <img alt="Auth: OAuth PKCE" src="https://img.shields.io/badge/auth-OAuth_PKCE-a4ffba?style=flat-square" /> <img alt="Runtime: JavaScript and Worker" src="https://img.shields.io/badge/runtime-JavaScript_%2B_Worker-24392e?style=flat-square" /></p>

# R1 Spotify

**A pocket-sized Spotify remote for rabbit r1 — with hardware controls and lyrics.**

See the artwork, track, artist, album and playback progress. Swipe to skip, press the side button to pause, and turn the wheel for volume. The Creation runs on r1 without a companion PC; audio continues on the active phone, computer or speaker signed in to the same Spotify account.

[Get started](#get-started) · [Controls](#controls) · [Self-host](#self-host) · [Privacy](#privacy-and-authentication) · [Troubleshooting](#troubleshooting) · [Verification](#verification)

> Community project. Playback control requires Spotify Premium and an active playback device. Access to the hosted site and permission to use its Spotify app are separate requirements. Public production availability is not established.

## Built for a small screen

| Capability | What you get |
| --- | --- |
| Hardware-first control | Side-button play/pause; wheel volume in 5% steps; artwork swipe for previous/next |
| Focused lyrics | Tap artwork to open lyrics; scroll with the wheel; follow the current line when timestamps exist |
| Multiple lyric sources | Bugs first, then LRCLIB exact/search and lyrics.ovh fallback |
| Session recovery | PKCE login, token refresh and on-device session restoration |
| Resilient playback state | Approximately 3-second foreground polling, interpolated progress and rate-limit backoff |
| Compact layout | Short viewport handling, bottom spacing and device diagnostics |

## Preview

<table><tr><th>Now playing</th><th>Lyrics focus</th><th>Follow controls</th></tr><tr><td><img src="docs/player-240x282.png" width="240" alt="Album artwork and playback controls" /></td><td><img src="docs/lyrics-only-240x282.png" width="240" alt="Lyrics-only view" /></td><td><img src="docs/lyrics-controls-240x282.png" width="240" alt="Lyrics follow checkbox" /></td></tr></table>

240 × 282 browser test captures with mocked responses, rather than live account or hardware photography.

## Get started

1. Open the [existing deployment](https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/) through your rabbit Creation. Its historical access setting was private and required the owner's ChatGPT login; current sharing settings have not been checked for this documentation update.
2. Ask the Spotify app owner to allowlist your account, or create your own Web API app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
3. For your own app, register the exact redirect URI shown by connection settings. For the existing deployment it is:

   `https://r1-spotify-player-jjs1124.plutoparty.chatgpt.site/`

   Keep the trailing slash. Enter your **Client ID** in connection settings. A Client Secret is neither needed nor used.
4. Complete Spotify login and grant playback read/control access.
5. Start a track on a phone, computer or speaker using the same account. The r1 screen will show the active track.

The [Creation configuration](docs/install-creation.json) and [installation QR](docs/install-qr.png) point to the existing deployment. Change the URL and regenerate the QR for a self-hosted instance.

## Controls

| Screen | Input | Action |
| --- | --- | --- |
| Player | Swipe artwork left / right | Next / previous track |
| Player | Press r1 side button once | Play / pause |
| Player | Wheel up / down | Volume +5% / −5%, within 0–100%, if supported by the active device |
| Player | Tap artwork | Open lyrics |
| Lyrics | Wheel or touch scroll | Explore freely; turns off automatic following |
| Lyrics | Tap, or press Enter | Reveal controls; another tap hides them; auto-hide after 3 seconds |
| Lyrics | Enable “현재 가사 따라가기” | Jump to and follow the current timed line |
| Lyrics | Swipe left / right, or Escape | Return to player without skipping tracks |
| Menu | Three dots | Connection settings, disconnect, help and device diagnostics |

Tapping lyrics preserves follow mode. Checkbox interaction restarts the controls timer. Plain lyrics have no timed follow mode. Vertical drags, short touches and cancelled gestures do not close lyrics. The current app interface is Korean; this README provides English setup and usage guidance.

## How it works

![Device, Spotify playback and lyrics data flow](docs/assets/architecture.svg)

The browser calls Spotify directly for authentication and playback control. A same-origin Worker serves the UI and the Bugs lyrics endpoint. LRCLIB and lyrics.ovh are browser fallbacks. This project controls an existing Spotify player; it does not stream audio to r1.

### Lyrics lookup

Bugs matching checks title, artist aliases and a duration difference of at most 2 seconds, prefers the same album, and examines at most three deduplicated candidates. Version names are retained; English titles are not automatically translated into Korean. Bugs returns plain lyrics. If unavailable, the client tries LRCLIB exact lookup and search, then lyrics.ovh. Tap the lyrics view to see the actual provider.

Bugs server lookup has a 20-second budget; the browser waits up to 25 seconds. Successful responses can be reused by the device for 5 minutes. Provider availability, coverage and public page structure may change.

## Self-host

Use a modern Node.js runtime with ES modules and the built-in test runner. No package installation is required; the repository does not declare a minimum Node version. This documentation was checked with Node.js 24.

```powershell
git clone https://github.com/plutoparty1/Rabbit_R1.git
cd Rabbit_R1/r1-spotify
node scripts/build.mjs
```

Deploy `dist/server/index.js` as the entry point, with `bugs.mjs` and `assets.mjs` beside it, to Cloudflare Workers or a compatible module Worker runtime. The repository does not include account-specific deployment configuration or a one-command publish script.

The build embeds the existing `dist` UI into the Worker; rebuild after editing frontend files. Static hosting of `dist` alone does not provide `/api/lyrics/bugs`.

After deployment:

- Register your exact HTTPS URL in your Spotify app and enter your own Client ID in connection settings.
- Update `docs/install-creation.json` and your rabbit Creation URL; generate a new installation QR.
- Verify site access, OAuth, playback, lyrics and reconnect on each target user's r1. A changed origin requires a new login.

### Sharing and release readiness

| Option | Requirements |
| --- | --- |
| Existing site + default Client ID | Site access and inclusion in the app owner's Spotify allowlist |
| Existing site + your Client ID | Site access and the existing URL registered in your own Spotify app |
| Your deployment + your Client ID | Compatible HTTPS hosting, your app registration and an updated Creation URL |

As checked on 2026-10-18, Spotify development mode requires a Premium app owner, allows up to five authenticated users and requires allowlisting. Login can succeed while API requests return 403 for an unlisted user. Wider distribution requires Spotify's extended quota approval; publishing the site does not remove that gate. See the [official quota-mode policy](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) for current eligibility.

The default Client ID's actual quota mode, allowlist and capacity cannot be determined from source. Before a public release, verify site audience, Spotify eligibility, lyric-provider terms, operational monitoring and hardware compatibility. No license file is present in this checkout, so commercial redistribution permission is not established by this README.

## Privacy and authentication

| Data | Handling |
| --- | --- |
| Access and refresh tokens | Native rabbit secure storage plus an on-device, same-origin IndexedDB backup; not localStorage or the site server |
| Pending OAuth transaction | Same-origin localStorage, 10-minute expiry, one-time state and PKCE verifier; removed on completion, disconnect or expiry checks |
| Client ID | Public app identifier stored in localStorage |
| Bugs request | Track title, artist, album and duration only; no Spotify token |
| Other lyrics requests | Track metadata sent to the selected provider; no Spotify credentials |

IndexedDB is browser storage, not a hardware-encrypted vault. The backup remains because a native storage success response may not guarantee persistence. Secure storage initialization is retried for a bounded time; persistent storage must be confirmed before the app reports that login will survive reopening.

Disconnect removes saved credentials and records a logout marker to block restoration from stale native storage. Clearing browser data, blocked storage or revoked Spotify permission may require login again. Disconnect before handing a shared device/profile to another person. OAuth callback codes are removed from the address; do not put tokens, credentials or authorization codes in issues, screenshots, QR codes or logs.

## Troubleshooting

| Symptom | Check or action |
| --- | --- |
| Site asks for ChatGPT login | Check site sharing/access with the owner, or self-host |
| OAuth redirect error | Match the exact HTTPS URI, including trailing slash, in the Dashboard |
| Login succeeds; controls return 403 | Check the allowlist, Premium account and playback-device restrictions |
| No current track | Start Spotify playback on another device with the same account |
| Volume does not change | Inspect device diagnostics; remote volume support depends on the active device, not merely its operating system |
| Lyrics do not follow | Check whether the provider returned timestamps, then enable the follow checkbox |
| Lyrics are missing | Check connectivity and provider availability; mismatched title/version/duration can prevent a match |
| Login is lost after reopening | Inspect storage diagnostics; reconnect if storage was cleared, blocked or authorization revoked |
| Rate limited / offline | The app respects Retry-After and labels last-known data; avoid repeated manual commands |
| Old or cropped UI after returning | Check the displayed version and viewport in diagnostics; compare deployment assets with source |

Foreground polling pauses while the app is hidden. Resume signals are coalesced, viewport size is rechecked, stale responses and queued volume input are invalidated, and displayed lyrics/free-scroll position are retained where possible. Failed skip commands are not blindly retried.

## Development

```text
r1-spotify/
├── dist/                 HTML, CSS and browser ES modules (frontend source)
├── server/               Worker entry and Bugs lookup
├── scripts/build.mjs     Embeds UI and generates dist/server/
├── tests/                Node tests and Playwright callback scenarios
├── docs/                 Installation, screenshots, evidence and SVG assets
└── DESIGN.md             UI design notes
```

### Verification

```powershell
node scripts/build.mjs
node --test tests/*.test.mjs
node --check dist/app.mjs
node --check dist/spotify.mjs
```

Node tests cover core logic, OAuth, Spotify, lyric matching, Bugs and Worker responses. The `tests/*-check.js` files are Playwright callback functions, not standalone Node test commands. Serve `dist` at `http://127.0.0.1:8791/`, then invoke each callback with a Playwright Page. Most scenarios mock Spotify and lyric responses; `bugs-browser-check.js` uses live Bugs lookup with mocked playback. No lint/typecheck configuration is included.

| Evidence | Scope and limits |
| --- | --- |
| Node suite | Reproducible automated logic checks; does not prove hardware behavior |
| Recorded browser scenarios | 240×282 and smaller viewports, gestures, wheel, follow controls, authentication recovery, volume and resume |
| Historical r6 user report | Login retention, wheel input, manual/follow lyrics and visible playback buttons |
| Pending | Latest WebView end-to-end behavior, r7 tap controls on hardware, full multi-user sharing flow and device-specific volume |

The source UI identifies itself as `20261008-r13`; the hosted version has not been verified here. [verification.json](docs/verification.json) is historical evidence dated 2026-10-08, not a new certification. Detailed Korean implementation and test notes are preserved in the [original documentation archive](docs/archive/README.2026-10-18.ko.md).

## Contributing and references

Report problems in [GitHub Issues](https://github.com/plutoparty1/Rabbit_R1/issues) with the displayed version, device/WebView, viewport, playback device, reproduction steps and redacted diagnostics. Keep documentation changes aligned across English and Korean; label mock captures and separate hardware reports from automated checks.

- [Spotify playback state](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback), [volume control](https://developer.spotify.com/documentation/web-api/reference/set-volume-for-users-playback) and [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow)
- [rabbit hardware events and secure storage](https://github.com/rabbit-hmi-oss/creations-sdk/blob/main/plugin-demo/reference/creation-triggers.md)
- [LRCLIB](https://lrclib.net/docs) and [lyrics.ovh](https://github.com/NTag/lyrics.ovh#api)

Original SVG project mark, hero and architecture assets live in [docs/assets](docs/assets). The illustrated device is a concept graphic. Spotify and rabbit names belong to their respective owners; this community project is not affiliated with or endorsed by either company. Visual hierarchy was informed by [jev-gate](https://github.com/MongLong0214/jev-gate); its assets were not copied.
