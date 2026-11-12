/** Hand-drawn vector creatures for the canvas scenes. Everything faces +x; callers rotate. No external assets. */
export const TAU = Math.PI * 2;
export const C = {
  honey: '#E8A317', honeyLight: '#F7CB63', honeyDeep: '#B97C00', plum: '#2B1D3A', plumLight: '#3D2A52',
  wasp: '#C2362B', waspGlow: '#FF5A4A', waspYellow: '#F2D027', ink: '#150C20', wing: 'rgba(236,232,255,0.55)',
};

export type Ctx = CanvasRenderingContext2D;

export function hexPath(ctx: Ctx, cx: number, cy: number, r: number, rot = Math.PI / 6) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = rot + (k * TAU) / 6;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function wings(ctx: Ctx, flap: number, span: number, len: number, fill: string, edge: string) {
  const open = 0.55 + 0.5 * Math.sin(flap);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(0.8, side * 1.6);
    ctx.rotate(side * (0.55 + open * 0.6));
    ctx.beginPath();
    ctx.ellipse(-len * 0.45, 0, len, span, 0, 0, TAU);
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = edge; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.restore();
  }
}

export interface BeeStyle { scale?: number; flap: number; glow?: number; carry?: number; crown?: boolean }

/** A honeybee seen from above. `carry` (0-1) draws a glowing drop of honey beneath it. */
export function drawBee(ctx: Ctx, x: number, y: number, angle: number, s: BeeStyle) {
  const k = s.scale ?? 1;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle); ctx.scale(k, k);
  if (s.glow) {
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 16);
    g.addColorStop(0, `rgba(247,203,99,${0.5 * s.glow})`); g.addColorStop(1, 'rgba(247,203,99,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
  }
  if (s.carry) {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(-1, 0, 0.5, -1, 0, 9);
    g.addColorStop(0, `rgba(255,214,102,${0.95 * s.carry})`); g.addColorStop(1, 'rgba(232,163,23,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(-1, 0, 9, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  wings(ctx, s.flap, 2.8, 7.5, C.wing, 'rgba(255,255,255,0.7)');
  // abdomen with stripes
  ctx.save();
  ctx.beginPath(); ctx.ellipse(-5, 0, 6.3, 3.9, 0, 0, TAU); ctx.clip();
  const body = ctx.createLinearGradient(0, -4, 0, 4);
  body.addColorStop(0, C.honeyLight); body.addColorStop(1, C.honey);
  ctx.fillStyle = body; ctx.fillRect(-12, -5, 14, 10);
  ctx.fillStyle = C.plum;
  for (const sx of [-9, -6, -3]) ctx.fillRect(sx, -5, 1.7, 10);
  ctx.restore();
  // stinger, thorax, head
  ctx.fillStyle = C.plum; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-12.8, -0.7); ctx.lineTo(-12.8, 0.7); ctx.fill();
  ctx.fillStyle = '#4a3320'; ctx.beginPath(); ctx.ellipse(1.2, 0, 3.5, 3.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = C.plum; ctx.beginPath(); ctx.arc(5.4, 0, 2.6, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(6.2, -1.2, 0.7, 0, TAU); ctx.arc(6.2, 1.2, 0.7, 0, TAU); ctx.fill();
  ctx.strokeStyle = C.plum; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(7, -0.8); ctx.lineTo(9.5, -2.4); ctx.moveTo(7, 0.8); ctx.lineTo(9.5, 2.4); ctx.stroke();
  if (s.crown) {
    ctx.fillStyle = C.honeyLight; ctx.strokeStyle = C.honeyDeep; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(3.8, -2.6); ctx.lineTo(5.2, -4.6); ctx.lineTo(5.8, -2.8); ctx.lineTo(7, -4.6); ctx.lineTo(7.6, -2.4); ctx.lineTo(7.6, 2.4); ctx.lineTo(7, 4.6); ctx.lineTo(5.8, 2.8); ctx.lineTo(5.2, 4.6); ctx.lineTo(3.8, 2.6); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** A wasp: slimmer, angular, hostile glow. `alpha` fades it in and out. */
export function drawWasp(ctx: Ctx, x: number, y: number, angle: number, s: { scale?: number; flap: number; alpha?: number }) {
  const k = s.scale ?? 1;
  ctx.save();
  ctx.globalAlpha = s.alpha ?? 1;
  ctx.translate(x, y); ctx.rotate(angle); ctx.scale(k, k);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 18);
  g.addColorStop(0, 'rgba(255,90,74,0.45)'); g.addColorStop(1, 'rgba(255,90,74,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  wings(ctx, s.flap * 1.4, 2.0, 7, 'rgba(120,90,130,0.5)', 'rgba(255,170,160,0.6)');
  ctx.strokeStyle = C.ink; ctx.lineWidth = 0.6;
  for (const sx of [0, 1.8, 3.4]) { ctx.beginPath(); ctx.moveTo(sx, -1.8); ctx.lineTo(sx - 1.5, -5); ctx.moveTo(sx, 1.8); ctx.lineTo(sx - 1.5, 5); ctx.stroke(); }
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.bezierCurveTo(-5, -3.3, -10, -3, -15, 0); ctx.bezierCurveTo(-10, 3, -5, 3.3, -1.5, 0); ctx.clip();
  ctx.fillStyle = C.waspYellow; ctx.fillRect(-16, -4, 16, 8);
  ctx.fillStyle = C.ink; for (const sx of [-12.5, -9, -5.5]) ctx.fillRect(sx, -4, 2, 8);
  ctx.restore();
  ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(0.8, 0, 3, 2.7, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2a1620'; ctx.beginPath(); ctx.arc(4.8, 0, 2.3, 0, TAU); ctx.fill();
  ctx.fillStyle = C.waspGlow; ctx.beginPath(); ctx.arc(5.6, -1.1, 0.8, 0, TAU); ctx.arc(5.6, 1.1, 0.8, 0, TAU); ctx.fill();
  ctx.restore();
}
