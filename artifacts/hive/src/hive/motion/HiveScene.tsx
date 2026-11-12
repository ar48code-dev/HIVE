import { useEffect, useRef } from 'react';
import { on } from './bus';
import { useMotion } from './prefs';
import { HiveSim } from './sim';

interface Props { payments: number; openAlerts: number; highAlerts: number }

/** The living hive: bees fly loops around a glowing honeycomb, payments arrive as honey-carrying bees, and open alerts are wasps held off by the Queen's shield. */
export function HiveScene({ payments, openAlerts, highAlerts }: Props) {
  const mode = useMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<HiveSim | null>(null);
  const threat = useRef({ openAlerts, highAlerts });
  threat.current = { openAlerts, highAlerts };

  useEffect(() => {
    const el = wrap.current, cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const s = new HiveSim(); sim.current = s;
    let raf = 0, last = 0, visible = true, running = true;

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth, h = el.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.resize(w, h);
      if (mode === 'calm') { s.setThreat(threat.current.openAlerts, threat.current.highAlerts); s.warm(3); s.draw(ctx); }
    };
    size();
    const ro = new ResizeObserver(size); ro.observe(el);

    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0 }); io.observe(el);

    const offPay = on('payment', ({ count }) => { if (mode === 'full') s.arrive(count); });
    const offAlert = on('alert', () => { if (mode === 'full') s.flare(); });

    if (mode === 'full') {
      const loop = (now: number) => {
        if (!running) return;
        const dt = last ? (now - last) / 1000 : 0.016; last = now;
        if (visible && !document.hidden) {
          s.setThreat(threat.current.openAlerts, threat.current.highAlerts);
          s.update(dt); ctx.clearRect(0, 0, el.clientWidth, el.clientHeight); s.draw(ctx);
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); s.setPointer(e.clientX - r.left, e.clientY - r.top, true); };
    const leave = () => s.setPointer(0, 0, false);
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);

    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); offPay(); offAlert(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [mode]);

  // In Calm mode the still frame should still reflect the alerts.
  useEffect(() => {
    const s = sim.current, cv = canvas.current, ctx = cv?.getContext('2d');
    if (mode === 'calm' && s && ctx) { s.setThreat(openAlerts, highAlerts); s.warm(1.5); s.draw(ctx); }
  }, [mode, openAlerts, highAlerts]);

  return (
    <section ref={wrap} className="scene" aria-label={`Illustration of your hive: ${payments} payments today and ${openAlerts} open ${openAlerts === 1 ? 'alert' : 'alerts'}. Bees are payments, wasps are alerts, and the Queen is Queen AI.`}>
      <canvas ref={canvas} aria-hidden="true" />
      <div className="scene-copy">
        <p className="scene-kicker">Your colony</p>
        <h2>Your money is the <em>honey</em>.<br />Payments are the bees.<br />The Queen watches the hive.</h2>
        <ul className="scene-chips">
          <li><i className="chip-ico bee" aria-hidden="true" />{payments} {payments === 1 ? 'payment' : 'payments'} today</li>
          <li><i className="chip-ico wasp" aria-hidden="true" />{openAlerts} open {openAlerts === 1 ? 'alert' : 'alerts'}</li>
          <li><i className="chip-ico queen" aria-hidden="true" />Queen AI is watching</li>
        </ul>
      </div>
    </section>
  );
}
