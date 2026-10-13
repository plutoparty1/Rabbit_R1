// 버튼 해제, 권한 대기, 늦은 음성 결과를 각각 구분합니다.
export class Ptt {
  constructor({ open, report, maxMs = 30000, finalMs = 10000 }) {
    Object.assign(this, { open, report, maxMs, finalMs });
    this.current = null;
  }
  async start() {
    if (this.current) return;
    const run = { released: false, text: '', handle: null, ended: false };
    this.current = run;
    this.report({ kind: 'listening' });
    run.maxTimer = setTimeout(() => this.cancel('녹음 최대 시간이 초과되었습니다.'), this.maxMs);
    const callbacks = {
      final: text => { if (this.current === run) run.text = text.trim(); },
      error: message => { if (this.current === run) this.cancel(message); },
      end: () => {
        if (this.current !== run || run.ended) return;
        run.ended = true;
        if (!run.released) { this.cancel('버튼 해제 전에 음성 입력이 종료되었습니다.'); return; }
        this.finish(run);
      },
    };
    try {
      const handle = await this.open(callbacks);
      if (this.current !== run) { handle.abort(); return; }
      run.handle = handle;
      if (run.released) handle.stop();
    } catch {
      if (this.current === run) this.cancel('마이크 또는 음성 입력을 시작하지 못했습니다.');
    }
  }
  release() {
    const run = this.current;
    if (!run || run.released) return;
    run.released = true;
    clearTimeout(run.maxTimer);
    this.report({ kind: 'finalizing' });
    run.finalTimer = setTimeout(() => this.cancel('최종 음성 결과 대기 시간이 초과되었습니다.'), this.finalMs);
    run.handle?.stop();
  }
  finish(run) {
    this.clear(run);
    this.report(run.text ? { kind: 'final', text: run.text } : { kind: 'empty' });
  }
  clear(run) {
    clearTimeout(run.maxTimer); clearTimeout(run.finalTimer);
    this.current = null;
  }
  cancel(message = '음성 입력이 취소되었습니다.') {
    const run = this.current;
    if (!run) return;
    this.clear(run);
    run.handle?.abort();
    this.report({ kind: 'cancelled', message });
  }
}
