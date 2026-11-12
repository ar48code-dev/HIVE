import { useState } from 'react';
import { money, SEVERITY_LABEL, type Severity, type Summary } from '../api';

interface Props {
  days: Summary['daily'];
  alertDays: Map<string, Severity>;
  onPick: (day: string) => void;
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const mix = (t: number) => {
  // light wax to deep honey
  const from = [246, 230, 191], to = [185, 124, 0];
  return `rgb(${lerp(from[0]!, to[0]!, t)}, ${lerp(from[1]!, to[1]!, t)}, ${lerp(from[2]!, to[2]!, t)})`;
};

export function Honeycomb({ days, alertDays, onPick }: Props) {
  const [active, setActive] = useState<Props['days'][number] | null>(null);
  const r = 24;
  const w = Math.sqrt(3) * r;
  const cols = 10;
  const rows = Math.ceil(days.length / cols);
  const width = cols * w + w / 2 + 8;
  const height = (rows - 1) * 1.5 * r + 2 * r + 8;
  // Scale to the 90th percentile so one huge day does not wash out every other cell.
  const sorted = days.map((d) => d.revenue).filter((v) => v > 0).sort((a, b) => a - b);
  const max = Math.max(1, sorted[Math.floor(sorted.length * 0.9)] ?? 1);

  const hex = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 180) * (60 * k - 30);
      return `${(cx + (r - 1.5) * Math.cos(a)).toFixed(1)},${(cy + (r - 1.5) * Math.sin(a)).toFixed(1)}`;
    }).join(' ');

  const describe = (d: Props['days'][number]) => {
    const sev = alertDays.get(d.day);
    return `${new Date(d.day + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}: ${money(Math.round(d.revenue * 100))} from ${d.payments} payments, ${money(Math.round(d.refunds * 100))} refunded${sev ? `. ${SEVERITY_LABEL[sev]} alert` : ''}`;
  };

  return (
    <div className="comb">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Revenue by day for the last 60 days" className="comb-svg">
        {days.map((d, i) => {
          const row = Math.floor(i / cols), col = i % cols;
          const cx = 4 + w / 2 + col * w + (row % 2 ? w / 2 : 0);
          const cy = 4 + r + row * 1.5 * r;
          const sev = alertDays.get(d.day);
          const t = Math.min(1, d.revenue / max);
          return (
            <g
              key={d.day}
              role="button"
              tabIndex={0}
              aria-label={describe(d)}
              className={`cell${i === days.length - 1 ? ' today' : ''}`}
              style={{ ['--i' as string]: i }}
              onMouseEnter={() => setActive(d)}
              onFocus={() => setActive(d)}
              onMouseLeave={() => setActive(null)}
              onBlur={() => setActive(null)}
              onClick={() => onPick(d.day)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(d.day); } }}
            >
              <polygon points={hex(cx, cy)} fill={d.revenue > 0 ? mix(t) : '#E7E2EE'} className={sev ? `alert-${sev}` : ''} />
              {sev && <circle cx={cx} cy={cy} r={4.2} className="wasp-dot" />}
              {i === days.length - 1 && <polygon points={hex(cx, cy)} className="ping" />}
            </g>
          );
        })}
      </svg>
      <p className="comb-readout" aria-live="polite">
        {active ? describe(active) : 'Hover or focus a cell for the day. Select one to see its transactions.'}
      </p>
      <div className="legend" aria-hidden="true">
        <span><i className="sw" style={{ background: mix(0.05) }} /> Quiet</span>
        <span><i className="sw" style={{ background: mix(1) }} /> Busy</span>
        <span><i className="sw wasp" /> Alert that day</span>
      </div>
    </div>
  );
}
