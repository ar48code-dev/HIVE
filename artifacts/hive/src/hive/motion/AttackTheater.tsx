import { useEffect, useRef, useState } from 'react';
import { on, type MotionEvents } from './bus';
import { useMotion } from './prefs';
import { TheaterSim, type TheaterPhase } from './theater';

type Run = MotionEvents['attack'] & { key: number };

/** A full-screen defence sequence for a simulated attack. It mirrors the real result: it only shows a catch if HIVE really raised an alert. */
export function AttackTheater() {
  const mode = useMotion();
  const [run, setRun] = useState<Run | null>(null);
  const [phase, setPhase] = useState<TheaterPhase>('incoming');
  const canvas = useRef<HTMLCanvasElement>(null);

  // Switching to Calm (or the system reduced-motion setting) stops a sequence that is already playing.
  useEffect(() => { if (mode === 'calm') setRun(null); }, [mode]);

  useEffect(() => on('attack', (d) => { if (mode === 'full') { setPhase('incoming'); setRun({ ...d, key: Date.now() }); } }), [mode]);

  useEffect(() => {
    if (!run) return;
    const cv = canvas.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = window.innerWidth, h = window.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sim = new TheaterSim({ w, h, transactions: run.transactions, caughtAfter: run.caughtAfter });
    let raf = 0, last = 0, shown: TheaterPhase = 'incoming', alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      const dt = last ? (now - last) / 1000 : 0.016; last = now;
      sim.update(dt); ctx.clearRect(0, 0, w, h); sim.draw(ctx);
      if (sim.phase !== shown) { shown = sim.phase; setPhase(shown); }
      if (sim.done) { setRun(null); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setRun(null); };
    window.addEventListener('keydown', esc);
    return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('keydown', esc); };
  }, [run]);

  if (!run) return null;
  return (
    <div className="theater" data-phase={phase}>
      <canvas ref={canvas} aria-hidden="true" />
      {phase !== 'incoming' && (
        <div className={`theater-card ${phase}`} aria-hidden="true">
          {phase === 'caught'
            ? <><strong>Caught after {run.caughtAfter} of {run.transactions}</strong><span>{run.title || 'Alert raised'}</span></>
            : <><strong>Not caught</strong><span>This attack slipped past every rule</span></>}
          <small>Simulated attack on synthetic data</small>
        </div>
      )}
      <button className="theater-skip" onClick={() => setRun(null)}>Skip animation (Esc)</button>
    </div>
  );
}
