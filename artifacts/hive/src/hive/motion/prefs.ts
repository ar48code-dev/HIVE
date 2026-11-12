import { useSyncExternalStore } from 'react';

export type MotionMode = 'full' | 'calm';
const KEY = 'hive-motion';
const listeners = new Set<() => void>();

const systemPrefersCalm = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function read(): MotionMode {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'full' || v === 'calm') return v;
  } catch { /* storage can be unavailable; fall through */ }
  return systemPrefersCalm() ? 'calm' : 'full';
}

let current: MotionMode | null = null;
const get = (): MotionMode => (current ??= read());

function apply(m: MotionMode) {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = m;
}

export function setMotion(m: MotionMode) {
  current = m;
  try { window.localStorage.setItem(KEY, m); } catch { /* ignore */ }
  apply(m);
  listeners.forEach((l) => l());
}

export function initMotion() { apply(get()); }

export function useMotion(): MotionMode {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, get, () => 'calm');
}
