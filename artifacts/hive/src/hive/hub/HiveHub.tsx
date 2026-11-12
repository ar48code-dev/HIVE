import { useEffect, useMemo, useRef, useState } from 'react';
import { alertTitle, money, SEVERITY_LABEL, type Alert, type Txn } from '../api';
import { on } from '../motion/bus';
import { useMotion } from '../motion/prefs';
import { BeeLogo, MotionToggle } from '../motion/Logo';
import { buildCells, type Cell, type Tab } from './features';
import { HubCanvas } from './canvas';
import type { Info, SwarmInput } from './swarm';

interface Props {
  txns: Txn[]; alerts: Alert[]; demo: boolean; ai: string; connected: boolean;
  onOpen: (tab: Tab) => void; onOpenAlert: (id: number) => void;
}

const ago = (ms: number) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

/** The home screen. Nineteen empty honeycomb cells in the hero's night-sky style; the Queen bee sits in the centre one. Touch a cell for its name; click and a worker bee flies in, the lid opens, and the page opens. */
export function HiveHub({ txns, alerts, demo, ai, connected, onOpen, onOpenAlert }: Props) {
  const cells = useMemo(buildCells, []);
  const motion = useMotion();
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HubCanvas | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [picked, setPicked] = useState<Cell | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; info: Info } | null>(null);
  const [label, setLabel] = useState<{ x: number; y: number } | null>(null);
  const [gl, setGl] = useState(true);
  const first = useRef(true);
  const cbs = useRef({ onOpen, onOpenAlert });
  cbs.current = { onOpen, onOpenAlert };

  const open = alerts.filter((a) => a.status === 'open');
  const input: SwarmInput = useMemo(() => ({
    bees: txns.slice().sort((a, b) => b.at - a.at).slice(0, 16).map((t) => ({
      id: t.id, kind: t.kind, amountCents: t.amountCents,
      label: `${t.kind === 'payment' ? 'Payment' : t.kind === 'refund' ? 'Refund' : 'Failed payment'} ${money(t.amountCents)}`, sub: `${t.customer} · ${ago(t.at)}`,
    })),
    wasps: open.slice(0, 8).map((a) => ({ alertId: a.id, severity: a.severity, label: `${SEVERITY_LABEL[a.severity]}: ${alertTitle(a)}`, sub: `${a.evidenceCount} transactions · click to open` })),
  }), [txns, alerts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build the 3D scene once per motion mode.
  useEffect(() => {
    const el = host.current; if (!el) return;
    let s: HubCanvas;
    try {
      s = new HubCanvas(el, cells, {
        hover: (c) => setHover(c), tip: (t) => setTip(t), label: (p) => setLabel(p),
        wasp: (id) => cbs.current.onOpenAlert(id),
        open: (c) => { setPicked(null); cbs.current.onOpen(c.tab); },
      });
    } catch { setGl(false); return; }
    scene.current = s; s.full = motion === 'full';
    s.swarm.sync(input, false); s.swarm.warm(4);
    let raf = 0, last = 0, run = true, visible = true;
    const ro = new ResizeObserver(() => s.resize()); ro.observe(el);
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }); io.observe(el);
    if (s.full) {
      const loop = (now: number) => { if (!run) return; const dt = Math.min(0.12, last ? (now - last) / 1000 : 0.016); last = now; if (visible && !document.hidden) s.render(dt); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    } else s.render(0);
    const offA = on('alert', () => { s.flare = 1; });
    return () => { run = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); offA(); s.dispose(); scene.current = null; };
  }, [motion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const s = scene.current; if (!s) return; s.swarm.sync(input, !first.current); first.current = false; if (!s.full) s.render(0); }, [input]);

  const stat = (c: Cell): string => {
    switch (c.id) {
      case 'radar': return open.length ? `${open.length} open ${open.length === 1 ? 'alert' : 'alerts'}` : 'No open alerts';
      case 'queen': return ai === 'template' ? 'Rule-based answers (no Gemini key)' : `Powered by ${ai}`;
      case 'connections': return demo ? 'PayPal checkout is off in demo mode' : connected ? 'Persistent Sandbox mode; inspect connections' : 'Open to check integrations';
      case 'agent': return 'Read-only MCP tools for other agents';
      case 'shop': return demo ? 'Simulated checkout' : 'PayPal sandbox checkout';
      default: return '';
    }
  };

  const touch = useRef(false);
  const shown = hover ?? picked;
  const choose = (c: Cell) => {
    const currentScene = scene.current;
    if (currentScene) currentScene.activate(c);
    else onOpen(c.tab);
  };

  return (
    <section className="hub" aria-label="HIVE home. Eighteen worker bees patrol the hive. Choose a cell to open a feature; the Queen opens Queen AI.">
      <header className="hub-top">
        <div className="hub-brand"><BeeLogo size={44} /><div><h1>HIVE</h1><p>The colony that investigates your money</p></div></div>
        <div className="hub-badges">
          {demo && <span className="hbadge demo" title="Everything on screen is generated, not real account data">Demo data</span>}
          <span className={`hbadge ${connected ? 'ok' : ''}`}>{demo ? 'PayPal checkout off in demo' : connected ? 'Sandbox-connected' : 'Check connections'}</span>
          <MotionToggle />
        </div>
      </header>

      <div className="hub-stage3d" ref={host}
        onPointerMove={(e) => { touch.current = e.pointerType === 'touch'; scene.current?.setPointer(e); scene.current?.hoverAt(); }}
        onPointerDown={(e) => {
          touch.current = e.pointerType === 'touch';
          if (e.pointerType !== 'touch') return;
          const s = scene.current; if (!s) return; s.setPointer(e); const o = s.hoverAt();
          if (o) { if (picked?.id === o.id) { s.click(); } else setPicked(o); } else s.click();
        }}
        onPointerLeave={() => { scene.current?.setPointer(null); scene.current?.hoverCell(null); setTip(null); }}
        onClick={(e) => { if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === 'touch') return; scene.current?.setPointer(e); scene.current?.click(); }}>
        {label && shown && <div className="hub-label" style={{ left: label.x, top: label.y }} aria-hidden="true">{shown.name}</div>}
        {tip && <div className="hub-tip" style={{ left: tip.x, top: tip.y }} role="status"><b>{tip.info.label}</b><span>{tip.info.sub}</span></div>}
        {!gl && <p className="notice warn">3D graphics are not available in this browser. Use the list below.</p>}
      </div>

      {/* Keyboard and screen-reader access: the same 19 cells as plain buttons. */}
      <ul className={gl ? 'sr' : 'hub-fallback'} aria-label="HIVE features">
        {cells.map((c) => <li key={c.id}><button type="button" onFocus={() => scene.current?.hoverCell(c)} onBlur={() => scene.current?.hoverCell(null)} onClick={() => choose(c)}>{c.name}</button></li>)}
      </ul>

      <div className="hub-readout" aria-live="polite">
        {shown ? (
          <>
            <h2>{shown.name}</h2>
            <p>{shown.blurb}</p>
            {stat(shown) && <p className="stat">{stat(shown)}</p>}
            <p className="hint">{picked && !hover ? 'Tap the cell again to open it.' : 'Click and a worker bee opens it.'}</p>
          </>
        ) : (
          <>
            <h2>Move over a cell to see what it does</h2>
            <p>18 worker bees patrol the hive. Honey-carrying bees show payments; wasps appear only for open alerts. Click the Queen to ask a question.</p>
            <ul className="legend"><li><i className="lb honey" />Payment</li><li><i className="lb pale" />Refund</li><li><i className="lb grey" />Failed</li><li><i className="lb wasp" />Alert (click it)</li></ul>
          </>
        )}
      </div>
    </section>
  );
}
