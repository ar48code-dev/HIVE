import { setMotion, useMotion } from './prefs';

/** The brand mark: a hex with a bee whose wings flap and who hovers. */
export function BeeLogo({ size = 38 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className="beelogo">
      <polygon points="50,4 90,27 90,73 50,96 10,73 10,27" fill="#E8A317" />
      <polygon points="50,12 83,31 83,69 50,88 17,69 17,31" fill="#2B1D3A" />
      <g className="bee-bob">
        <g className="wing wing-l"><ellipse cx="38" cy="43" rx="12" ry="6.5" fill="rgba(236,232,255,0.85)" /></g>
        <g className="wing wing-r"><ellipse cx="62" cy="43" rx="12" ry="6.5" fill="rgba(236,232,255,0.85)" /></g>
        <ellipse cx="50" cy="56" rx="10" ry="14" fill="#E8A317" />
        <rect x="40" y="52" width="20" height="3.4" fill="#2B1D3A" /><rect x="40" y="59" width="20" height="3.4" fill="#2B1D3A" />
        <circle cx="50" cy="39" r="6.2" fill="#F7CB63" />
      </g>
    </svg>
  );
}

/** Three bees circling a hex while the hive loads. */
export function BeeLoader({ label = 'Loading the hive…' }: { label?: string }) {
  return (
    <div className="beeload" role="status">
      <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden="true">
        <polygon points="40,18 58,29 58,51 40,62 22,51 22,29" fill="#E8A317" opacity="0.9" />
        {[0, 1, 2].map((i) => <g key={i} className="orbit" style={{ animationDelay: `${i * -0.5}s` }}><circle cx="40" cy="5" r="3.6" fill="#2B1D3A" /><circle cx="40" cy="5" r="2" fill="#F7CB63" /></g>)}
      </svg>
      <span>{label}</span>
    </div>
  );
}

export function MotionToggle() {
  const mode = useMotion();
  return (
    <button type="button" className="badge motion-toggle" aria-pressed={mode === 'full'} onClick={() => setMotion(mode === 'full' ? 'calm' : 'full')} title="Animations can be switched off. Your browser's reduced-motion setting is respected by default.">
      Motion: {mode === 'full' ? 'full' : 'calm'}
    </button>
  );
}
