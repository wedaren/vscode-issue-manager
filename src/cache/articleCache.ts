type CacheEntry<T> = { value: T; expiresAt: number };

const map = new Map<string, CacheEntry<any>>();

export function setCache<T>(key: string, value: T, ttlSeconds = 60 * 60) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  map.set(key, { value, expiresAt });
}

export function getCache<T>(key: string): T | undefined {
  const e = map.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    map.delete(key);
    return undefined;
  }
  return e.value as T;
}

export function clearCache() {
  map.clear();
}
