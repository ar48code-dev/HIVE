import type { Growth } from '../api';

/** A small honeycomb that fills as you look after your finances. It rewards reviewing, never spending. */
export function Colony({ growth }: { growth: Growth }) {
  const r = 15, w = Math.sqrt(3) * r;
  // axial coordinates of a 19-cell flower (radius 2), centre first, then outward
  const cells: Array<[number, number]> = [];
  for (let q = -2; q <= 2; q++) for (let s = -2; s <= 2; s++) if (Math.abs(q + s) <= 2) cells.push([q, s]);
  cells.sort((a, b) => Math.hypot(a[0] + a[1] / 2, a[1]) - Math.hypot(b[0] + b[1] / 2, b[1]) || Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  const size = 2 * (2 * w + r) + 12;
  const hex = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 180) * (60 * k - 30); return `${(cx + (r - 1.2) * Math.cos(a)).toFixed(1)},${(cy + (r - 1.2) * Math.sin(a)).toFixed(1)}`; }).join(' ');
  const done = growth.achievements.filter((a) => a.done).length;

  return (
    <section className="panel colony" aria-labelledby="c-h">
      <h2 id="c-h">Your colony</h2>
      <p className="muted">It grows when you review alerts, decide on proposals, ask questions and test your defences.</p>
      <div className="colony-body">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${growth.cells} of ${growth.capacity} cells built`} className="colony-svg">
          {cells.map(([q, s], i) => {
            const cx = size / 2 + w * (q + s / 2), cy = size / 2 + 1.5 * r * s;
            return <polygon key={i} points={hex(cx, cy)} className={i < growth.cells ? 'cell-full' : 'cell-empty'} />;
          })}
        </svg>
        <div>
          <p className="colony-count"><strong>{growth.cells}</strong> of {growth.capacity} cells built</p>
          <ul className="badges-list">
            {growth.achievements.map((a) => (
              <li key={a.id} className={a.done ? 'done' : ''}>
                <span aria-hidden="true">{a.done ? '✓' : '○'}</span>
                <span><strong>{a.title}</strong> <small>{a.done ? 'Done' : a.hint}</small></span>
              </li>
            ))}
          </ul>
          <p className="muted small">{done} of {growth.achievements.length} achievements</p>
        </div>
      </div>
    </section>
  );
}
