// Test setup: a working Web Storage for the stores under test.
//
// Node 22+ declares `localStorage` / `sessionStorage` as globals that are UNUSABLE unless the
// process is started with --localstorage-file (accessing them yields undefined plus an
// ExperimentalWarning), and jsdom 30 under vitest no longer installs its own over them. The
// stores guard with `typeof localStorage !== 'undefined'`, which is true for a declared-but-
// undefined global, so persistence threw and the store tests went red on `main` after the
// 2026-09-07 bump. Install an in-memory Storage only when the real one is missing or unusable —
// never over a working browser storage — so `main` is green on every Node the CI matrix runs.

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

function usable(candidate: unknown): candidate is Storage {
  return !!candidate && typeof (candidate as Storage).getItem === 'function';
}

for (const name of ['localStorage', 'sessionStorage'] as const) {
  const g = globalThis as unknown as Record<string, unknown>;
  let current: unknown;
  try {
    current = g[name];
  } catch {
    current = undefined;
  }
  if (!usable(current)) {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true });
  }
}
