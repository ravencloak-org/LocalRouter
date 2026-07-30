// Shared Core <-> Dashboard contract. The only thing both sides import.
// See CONTEXT.md (Event, Request, Span) and PLAN.md (Observability).

export type RequestPhase = "queued" | "spawning" | "streaming" | "done" | "error";

export type LrEvent =
  | {
      kind: "request";
      id: string;
      ts: number;
      requestId: string;
      model: string;
      phase: RequestPhase;
      queueWaitMs?: number;
      latencyMs?: number;
      promptTokens?: number;
      completionTokens?: number;
      costUsd?: number;
      httpStatus?: number;
      errorType?: string;
      preview?: string;
    }
  | { kind: "log"; id: string; ts: number; level: "debug" | "info" | "warn" | "error"; msg: string; requestId?: string }
  | {
      kind: "span";
      id: string;
      ts: number;
      requestId: string;
      traceId: string;
      spanId: string;
      parentId?: string;
      name: string;
      durationMs: number;
      attrs: Record<string, unknown>;
    }
  | { kind: "token"; id: string; ts: number; requestId: string; delta: string };

// OpenAI error envelope every failure returns (see PLAN.md error taxonomy).
export type OpenAIError = { error: { message: string; type: string; code?: string } };
