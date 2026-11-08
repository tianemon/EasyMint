import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
const KEY = 'easymint.appearance'; // 仅外观偏好，允许持久化（契约 C6）

function readMode(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme(): {
  mode: ThemeMode;
  effectiveMode: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = mode;
    const color = mode === 'dark' || (mode === 'system' && systemDark) ? '#141414' : '#f4f4f2';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [mode, systemDark]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try { localStorage.setItem(KEY, next); } catch { /* 隐私模式：仅本次会话生效 */ }
  }, []);

  return { mode, effectiveMode: mode === 'system' ? (systemDark ? 'dark' : 'light') : mode, setMode };
}
