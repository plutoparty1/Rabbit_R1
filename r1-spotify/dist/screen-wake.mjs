// Keep the voice panel visible when the browser/OS permits it. Never simulate input.
export function createScreenWakeLock({
  wakeLock = globalThis.navigator?.wakeLock,
  isVisible = () => !globalThis.document?.hidden,
  onChange = () => {},
} = {}) {
  let wanted = false, epoch = 0, sentinel = null, pending = null, status = 'idle';
  const update = next => {
    if (status === next) return;
    status = next;
    onChange(status);
  };
  const release = async lock => {
    try { if (lock && !lock.released) await lock.release(); } catch {}
  };
  return {
    get status() { return status; },
    setActive(active) {
      if (!active) {
        wanted = false; epoch++; pending = null;
        const previous = sentinel;
        sentinel = null;
        update('idle');
        return release(previous).then(() => status);
      }
      // A denial/system release is retried only after the next explicit close/open.
      if (wanted) return pending || Promise.resolve(status);
      wanted = true;
      const requestEpoch = ++epoch;
      if (typeof wakeLock?.request !== 'function') {
        update('unsupported');
        return Promise.resolve(status);
      }
      if (!isVisible()) {
        update('released');
        return Promise.resolve(status);
      }
      update('requesting');
      const operation = (async () => {
        try {
          const lock = await wakeLock.request('screen');
          if (!wanted || requestEpoch !== epoch || !isVisible()) {
            await release(lock);
            if (wanted && requestEpoch === epoch) update('released');
            return status;
          }
          if (!lock || typeof lock.release !== 'function') throw new Error('Unavailable wake lock');
          if (lock.released) { update('released'); return status; }
          sentinel = lock;
          lock.addEventListener?.('release', () => {
            if (sentinel !== lock) return;
            sentinel = null;
            if (wanted && requestEpoch === epoch) update('released');
          }, { once: true });
          update('active');
        } catch {
          if (wanted && requestEpoch === epoch) update('denied');
        }
        return status;
      })();
      pending = operation;
      void operation.finally(() => { if (pending === operation) pending = null; });
      return operation;
    },
  };
}
