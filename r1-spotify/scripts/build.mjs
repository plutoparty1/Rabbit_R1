// 기존 정적 화면을 서버에 포함하여 별도 라이브러리나 파일 저장소 없이 동일한 주소로 제공합니다.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const types = { 'index.html': 'text/html', 'style.css': 'text/css', 'app.mjs': 'text/javascript', 'core.mjs': 'text/javascript', 'spotify.mjs': 'text/javascript' };
const assets = {};
types['i18n.mjs'] = 'text/javascript';
types['voice.mjs'] = 'text/javascript';
types['rabbit-test.html'] = 'text/html';
types['rabbit-test.css'] = 'text/css';
for (const name of ['rabbit-test.mjs', 'rabbit-probe.mjs', 'local-speech.mjs', 'local-asr-worker.mjs', 'song-request.mjs']) types[name] = 'text/javascript';
types['pair.html'] = 'text/html';
for (const name of ['pair.mjs', 'pair-api.mjs', 'pair-device.mjs', 'qrcode.mjs']) types[name] = 'text/javascript';
for (const [filename, type] of Object.entries(types)) {
  assets['/' + filename] = { type: type + '; charset=utf-8', body: await readFile(new URL('dist/' + filename, root), 'utf8') };
}
// Font files are served locally, without a third-party font request.
for (const filename of await readdir(new URL('dist/fonts/', root))) {
  if (!/^[a-f0-9]{16}\.woff2$/.test(filename)) continue;
  assets['/fonts/' + filename] = { type: 'font/woff2', encoding: 'base64', body: (await readFile(new URL('dist/fonts/' + filename, root))).toString('base64') };
}
const output = new URL('dist/server/', root);
await mkdir(output, { recursive: true });
await copyFile(new URL('server/worker.mjs', root), new URL('index.js', output));
await copyFile(new URL('server/pairing.mjs', root), new URL('pairing.mjs', output));
await copyFile(new URL('server/voice.mjs', root), new URL('voice.mjs', output));
await copyFile(new URL('server/bugs.mjs', root), new URL('bugs.mjs', output));
await copyFile(new URL('server/spotify-lyrics.mjs', root), new URL('spotify-lyrics.mjs', output));
await copyFile(new URL('server/lyrics-bridge.mjs', root), new URL('lyrics-bridge.mjs', output));
// 이 출력은 배포용 생성 파일이며 임시파일 정리 대상이 아닙니다.
await writeFile(new URL('assets.mjs', output), '// 기존 화면을 원문 그대로 포함한 배포 자료입니다.\nexport default ' + JSON.stringify(assets) + ';\n', 'utf8');
console.log('벅스 조회를 포함한 배포 파일이 준비되었습니다.');
