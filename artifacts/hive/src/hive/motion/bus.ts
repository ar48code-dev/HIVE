/** A tiny event bus so screens can tell the animated scenes what just happened, without knowing about them. */
export interface MotionEvents {
  payment: { count: number };
  alert: { severity: 'low' | 'medium' | 'high' };
  attack: { transactions: number; caughtAfter: number | null; title: string };
}

const target = new EventTarget();

export function emit<K extends keyof MotionEvents>(name: K, detail: MotionEvents[K]) {
  target.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on<K extends keyof MotionEvents>(name: K, fn: (detail: MotionEvents[K]) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<MotionEvents[K]>).detail);
  target.addEventListener(name, h);
  return () => target.removeEventListener(name, h);
}
