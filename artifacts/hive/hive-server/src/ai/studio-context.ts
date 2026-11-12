export interface PreservedStudioTurn {
  id: string;
  content: { role: 'model'; parts: Record<string, unknown>[] };
  calls: Array<{ callId: string; name: string }>;
}

interface StoredTurn extends PreservedStudioTurn {
  expiresAt: number;
  anchors: string[];
}

/** AG Studio's provider-neutral history omits Gemini's opaque thought signatures. */
export class StudioContextStore {
  private readonly turns = new Map<string, StoredTurn>();
  private readonly byAnchor = new Map<string, StoredTurn>();

  constructor(
    private readonly ttlMs = 30 * 60_000,
    private readonly maxTurns = 200,
    private readonly now: () => number = Date.now,
  ) {}

  remember(turn: PreservedStudioTurn, outputIds: string[]): void {
    this.prune();
    while (this.turns.size >= this.maxTurns) {
      const oldest = this.turns.values().next().value as StoredTurn | undefined;
      if (!oldest) break;
      this.remove(oldest);
    }
    const stored: StoredTurn = {
      ...structuredClone(turn),
      expiresAt: this.now() + this.ttlMs,
      anchors: [
        ...outputIds.map(id => `item:${id}`),
        ...turn.calls.map(call => `call:${call.callId}`),
      ],
    };
    this.turns.set(turn.id, stored);
    for (const anchor of stored.anchors) this.byAnchor.set(anchor, stored);
  }

  resolve(id?: string, callId?: string): PreservedStudioTurn | undefined {
    this.prune();
    return (id ? this.byAnchor.get(`item:${id}`) : undefined)
      ?? (callId ? this.byAnchor.get(`call:${callId}`) : undefined);
  }

  private prune(): void {
    const now = this.now();
    for (const turn of this.turns.values()) {
      if (turn.expiresAt <= now) this.remove(turn);
    }
  }

  private remove(turn: StoredTurn): void {
    this.turns.delete(turn.id);
    for (const anchor of turn.anchors) this.byAnchor.delete(anchor);
  }
}
