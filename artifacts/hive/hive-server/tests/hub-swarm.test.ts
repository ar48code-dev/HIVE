import { describe, expect, it, vi } from 'vitest';
import { HubCanvas } from '../../src/hive/hub/canvas.js';
import { buildCells } from '../../src/hive/hub/features.js';
import { PATROL_BEE_COUNT, Swarm } from '../../src/hive/hub/swarm.js';

describe('HIVE landing-page colony', () => {
  it('keeps 18 animated patrol bees visible without inventing payment events', () => {
    const swarm = new Swarm(buildCells());
    swarm.sync({ bees: [], wasps: [] }, false);
    const before = swarm.patrolBees.map((bee) => [bee.x, bee.y]);

    swarm.update(1 / 30);

    expect(swarm.patrolBees).toHaveLength(PATROL_BEE_COUNT);
    expect(swarm.agents).toHaveLength(0);
    expect(swarm.patrolBees.map((bee) => [bee.x, bee.y])).not.toEqual(before);
  });

  it('shows alert wasps only when an open alert is supplied', () => {
    const swarm = new Swarm(buildCells());
    swarm.sync({
      bees: [],
      wasps: [{ alertId: 9, severity: 'high', label: 'High-risk alert', sub: '3 transactions' }],
    }, false);

    expect(swarm.agents).toHaveLength(1);
    expect(swarm.agents[0]?.hue).toBe('wasp');
  });

  it('opens Queen AI when the Queen cell is activated', () => {
    const cells = buildCells();
    const queen = cells.find((cell) => cell.id === 'queen')!;
    const open = vi.fn();
    const canvas = Object.create(HubCanvas.prototype) as HubCanvas;
    Object.assign(canvas, { busy: false, full: false, cells, cb: { open } });

    canvas.activate(queen);

    expect(queen.tab).toBe('queen');
    expect(open).toHaveBeenCalledWith(queen);
  });

  it('opens Queen AI after a click completes the worker-flight animation', () => {
    const cells = buildCells();
    const queen = cells.find((cell) => cell.id === 'queen')!;
    const open = vi.fn();
    const canvas = Object.create(HubCanvas.prototype) as HubCanvas;
    Object.assign(canvas, {
      busy: false, full: true, cells, cb: { open }, swarm: new Swarm(cells),
      mouse: { x: 300, y: 280 }, cx: 300, cy: 280, k: 1, px: 0, py: 0,
      tpx: 0, tpy: 0, time: 0, flare: 0,
      hov: Array(cells.length).fill(0), open: Array(cells.length).fill(0), worker: null,
    });

    canvas.click();
    expect((canvas as unknown as { worker: unknown }).worker).not.toBeNull();

    const step = (canvas as unknown as { step: (dt: number) => void }).step.bind(canvas);
    for (let i = 0; i < 100; i++) step(0.02);

    expect(open).toHaveBeenCalledWith(queen);
  });
});
