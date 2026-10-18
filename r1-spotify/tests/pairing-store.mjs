// Minimal strongly consistent R2 test double, including conditional write conflicts.
export class PairingStore {
  records = new Map();
  revision = 0;
  async get(key) {
    const stored = this.records.get(key);
    return stored ? { etag: stored.etag, json: async () => JSON.parse(stored.value) } : null;
  }
  async put(key, value, options = {}) {
    const old = this.records.get(key), condition = options.onlyIf;
    if (condition instanceof Headers && condition.get('If-None-Match') === '*' && old) return null;
    if (condition?.etagMatches && old?.etag !== condition.etagMatches) return null;
    const etag = String(++this.revision);
    this.records.set(key, { value, etag, customMetadata: options.customMetadata });
    return { etag };
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.records.delete(key); }
  async list({ prefix, limit }) { return { objects: [...this.records].filter(([key]) => key.startsWith(prefix)).slice(0, limit).map(([key, value]) => ({ key, customMetadata: value.customMetadata })) }; }
}
