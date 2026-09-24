// Remembers small per-visitor choices (sound on/off...). Storage can be
// unavailable (private windows, blocked cookies): then we just use defaults.

const PREFIX = 'jvm-explorer.';

export function loadPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, value ? '1' : '0');
  } catch {
    // Not remembered, that's all.
  }
}
