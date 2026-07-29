// LocalRouter Core. OpenAI-compatible HTTP -> claude CLI. Emits Events for the Dashboard.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bus, uid } from "./bus";
import { runClaude, queueDepth, cliAlive, CliError, TimeoutError } from "./claude";
import type { LrEvent, OpenAIError } from "../shared/events";

const app = new Hono();
const now = () => Date.now();
const rid = () => `req-${crypto.randomUUID().slice(0, 8)}`;
const chatId = () => `chatcmpl-${crypto.randomUUID().slice(0, 12)}`;

function emit(e: Omit<LrEvent, "id" | "ts">) {
  bus.emit({ id: uid(), ts: now(), ...e } as LrEvent);
}
function errBody(message: string, type: string): OpenAIError {
  return { error: { message, type, code: type } };
}

// map a thrown error -> [httpStatus, errorType, detail]  (PLAN.md taxonomy)
function classify(err: unknown): [number, string, string] {
  if (err instanceof TimeoutError) return [504, "timeout", "request timed out"];
  if (err instanceof CliError) {
    const s = err.stderr.toLowerCase();
    if (/logg?ed in|login|unauthor|authentication/.test(s)) return [503, "cli_unavailable", err.stderr];
    if (/usage limit|quota/.test(s)) return [429, "usage_limit_exceeded", err.stderr];
    if (/rate limit|overloaded|\b429\b/.test(s)) return [429, "rate_limit_exceeded", err.stderr];
    return [502, "upstream_error", err.stderr];
  }
  return [502, "upstream_error", String(err)];
}

function flatten(messages: any[]): { system: string; prompt: string } {
  const txt = (c: unknown) => (typeof c === "string" ? c : JSON.stringify(c));
  const system = messages.filter((m) => m.role === "system").map((m) => txt(m.content)).join("\n");
  const prompt = messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${txt(m.content)}`)
    .join("\n");
  return { system, prompt };
}

function finishReq(requestId: string, model: string, t0: number, pin: number, pout: number) {
  const durationMs = now() - t0;
  emit({ kind: "request", requestId, model, phase: "done", latencyMs: durationMs, promptTokens: pin, completionTokens: pout, httpStatus: 200 });
  // ponytail: synthesized span, no OTel SDK yet. Swap for a real tracer + OTLP export later.
  emit({ kind: "span", requestId, traceId: requestId, spanId: uid(), name: "chat.completion", durationMs, attrs: { promptTokens: pin, completionTokens: pout } });
}
function failReq(requestId: string, model: string, t0: number, httpStatus: number, errorType: string, detail: string) {
  emit({ kind: "request", requestId, model, phase: "error", latencyMs: now() - t0, httpStatus, errorType, preview: detail.slice(0, 120) });
  emit({ kind: "log", level: "error", msg: `${errorType}: ${detail.slice(0, 200)}`, requestId });
}

app.get("/healthz", async (c) => {
  const ok = await cliAlive();
  return c.json({ status: ok ? "ok" : "cli_unavailable", queueDepth: queueDepth() }, ok ? 200 : 503);
});

app.get("/v1/models", (c) =>
  c.json({ object: "list", data: [{ id: "claude", object: "model", owned_by: "anthropic" }] }));

app.post("/v1/embeddings", (c) =>
  c.json(errBody("No embeddings on the claude CLI. Route EMBEDDING_* to TEI / OpenAI / Voyage.", "unsupported"), 400));

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.messages?.length) return c.json(errBody("`messages` required", "invalid_request_error"), 400);

  const requestId = rid();
  const model = body.model ?? "claude";
  const wantStream = !!body.stream;
  const { system, prompt } = flatten(body.messages);
  const t0 = now();
  emit({ kind: "request", requestId, model, phase: "queued", queueWaitMs: 0 });

  if (wantStream) {
    return streamSSE(c, async (ss) => {
      const id = chatId();
      const created = Math.floor(now() / 1000);
      try {
        emit({ kind: "request", requestId, model, phase: "streaming" });
        const gen = runClaude(system, prompt);
        let r = await gen.next();
        while (!r.done) {
          // ponytail: also broadcasts every token to all /events subscribers; add
          // throttle + focus-only subscription per PLAN.md before this gets loud.
          emit({ kind: "token", requestId, delta: r.value });
          await ss.writeSSE({
            data: JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: r.value }, finish_reason: null }] }),
          });
          r = await gen.next();
        }
        await ss.writeSSE({ data: JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) });
        await ss.writeSSE({ data: "[DONE]" });
        finishReq(requestId, model, t0, r.value.inputTokens, r.value.outputTokens);
      } catch (err) {
        const [status, type, detail] = classify(err);
        failReq(requestId, model, t0, status, type, detail);
        await ss.writeSSE({ data: JSON.stringify(errBody(detail, type)) });
        await ss.writeSSE({ data: "[DONE]" });
      }
    });
  }

  // non-stream: drain generator, return one complete chat.completion
  try {
    emit({ kind: "request", requestId, model, phase: "spawning" });
    const gen = runClaude(system, prompt);
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    const { text, inputTokens, outputTokens } = r.value;
    finishReq(requestId, model, t0, inputTokens, outputTokens);
    return c.json({
      id: chatId(),
      object: "chat.completion",
      created: Math.floor(now() / 1000),
      model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text } }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    });
  } catch (err) {
    const [status, type, detail] = classify(err);
    failReq(requestId, model, t0, status, type, detail);
    return c.json(errBody(detail, type), status as 400 | 429 | 502 | 503 | 504);
  }
});

// Dashboard feed: replay ring buffer, then live-subscribe until client disconnects.
app.get("/events", (c) =>
  streamSSE(c, async (ss) => {
    for (const e of bus.history()) await ss.writeSSE({ data: JSON.stringify(e) });
    const unsub = bus.subscribe((e) => void ss.writeSSE({ data: JSON.stringify(e) }));
    await new Promise<void>((res) => c.req.raw.signal.addEventListener("abort", () => (unsub(), res())));
  }));

const port = Number(process.env.LR_PORT ?? 8083);
console.log(`[LocalRouter] core on :${port}`);
export default { port, fetch: app.fetch };
