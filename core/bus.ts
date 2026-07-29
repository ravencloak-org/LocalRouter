// In-memory event bus: ring buffer of recent Events + live subscribers.
// No DB in v0 (PLAN.md: SQLite later if durable history is wanted).
import type { LrEvent } from "../shared/events";

type Sub = (e: LrEvent) => void;

class EventBus {
  private ring: LrEvent[] = [];
  private subs = new Set<Sub>();
  private cap = Number(process.env.LR_RING ?? 1000);

  emit(e: LrEvent) {
    this.ring.push(e);
    if (this.ring.length > this.cap) this.ring.shift();
    for (const s of this.subs) s(e);
  }

  history() {
    return this.ring;
  }

  subscribe(s: Sub) {
    this.subs.add(s);
    return () => this.subs.delete(s);
  }
}

export const bus = new EventBus();

let seq = 0;
export const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;
