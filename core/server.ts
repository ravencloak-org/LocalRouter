// LocalRouter Core. OpenAI-compatible HTTP -> claude CLI. Emits Events for the Dashboard.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { bus, uid } from "./bus";
import { runClaude, queueDepth, cliAlive, CliError, TimeoutError, type ClaudeResult } from "./claude";
import { getConfig, setConfig, type Effort, type Config } from "./config";
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

function finishReq(requestId: string, model: string, t0: number, res: ClaudeResult) {
  const durationMs = now() - t0;
  emit({ kind: "request", requestId, model, phase: "done", latencyMs: durationMs, promptTokens: res.inputTokens, completionTokens: res.outputTokens, httpStatus: 200 });
  // ponytail: synthesized span, no OTel SDK yet. Swap for a real tracer + OTLP export later.
  emit({
    kind: "span", requestId, traceId: requestId, spanId: uid(), name: "chat.completion", durationMs,
    attrs: { promptTokens: res.inputTokens, completionTokens: res.outputTokens, costUsd: res.costUsd, cacheReadTokens: res.cacheReadTokens, cacheCreationTokens: res.cacheCreationTokens },
  });
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
        finishReq(requestId, model, t0, r.value);
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
    const res = r.value;
    finishReq(requestId, model, t0, res);
    return c.json({
      id: chatId(),
      object: "chat.completion",
      created: Math.floor(now() / 1000),
      model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: res.text } }],
      usage: { prompt_tokens: res.inputTokens, completion_tokens: res.outputTokens, total_tokens: res.inputTokens + res.outputTokens },
    });
  } catch (err) {
    const [status, type, detail] = classify(err);
    failReq(requestId, model, t0, status, type, detail);
    return c.json(errBody(detail, type), status as 400 | 429 | 502 | 503 | 504);
  }
});

// --- Control surface (ADR-0003). Localhost-only + custom-header CSRF guard. ---
// ponytail: header gate stops drive-by form CSRF (browsers preflight non-simple headers and
// we set no permissive CORS). A per-boot token is the hardening follow-up.
app.use("/control/*", async (c, next) => {
  if (c.req.header("x-localrouter") !== "1")
    return c.json(errBody("control requires the X-LocalRouter: 1 header", "forbidden"), 403);
  await next();
});

app.get("/control/status", async (c) =>
  c.json({ running: true, loggedIn: await cliAlive(), queueDepth: queueDepth(), ...getConfig() }));

app.post("/control/config", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as {
    model?: string; effort?: string; port?: number | string; anthropicBaseUrl?: string;
  };
  const patch: Partial<Config> = {};
  if (b.model) patch.model = String(b.model);
  if (b.effort && ["low", "medium", "high"].includes(b.effort)) patch.effort = b.effort as Effort;
  if (b.port != null) {
    const p = Number(b.port);
    if (Number.isInteger(p) && p > 0 && p < 65536) patch.port = p; // applies on restart
  }
  if ("anthropicBaseUrl" in b) patch.anthropicBaseUrl = b.anthropicBaseUrl ? String(b.anthropicBaseUrl) : undefined;
  return c.json(setConfig(patch));
});

app.post("/control/login", (c) => {
  // Interactive OAuth: opens a browser. Needs a TTY on headless hosts (see ADR-0003);
  // the macOS tray runs this in Terminal.app instead.
  Bun.spawn(["claude", "login"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return c.json({ started: true });
});

app.post("/control/shutdown", (c) => {
  setTimeout(() => process.exit(0), 100);
  return c.json({ stopping: true });
});

// Dashboard feed: replay ring buffer, then live-subscribe until client disconnects.
app.get("/events", (c) =>
  streamSSE(c, async (ss) => {
    for (const e of bus.history()) await ss.writeSSE({ data: JSON.stringify(e) });
    const unsub = bus.subscribe((e) => void ss.writeSSE({ data: JSON.stringify(e) }));
    await new Promise<void>((res) => c.req.raw.signal.addEventListener("abort", () => (unsub(), res())));
  }));

// --- Static dashboard. Registered LAST so /v1/*, /control/*, /events, /healthz win. ---
// Resolve the built dashboard cwd-INDEPENDENTLY so `/` never 404s from a stray cwd:
// dev (cwd/web/dist), the .app bundle (<exe>/../Resources/web/dist), or binary-adjacent.
const exeDir = dirname(process.execPath);
const distRoot = [
  join(process.cwd(), "web", "dist"),
  join(exeDir, "..", "Resources", "web", "dist"),
  join(exeDir, "web", "dist"),
].find((d) => existsSync(join(d, "index.html")));
if (distRoot) {
  app.use("/*", serveStatic({ root: distRoot }));
  app.get("/*", serveStatic({ path: join(distRoot, "index.html") })); // SPA fallback
} else {
  app.get("/*", (c) =>
    c.html("<!doctype html><title>LocalRouter</title><body style=font-family:system-ui;padding:2rem><h1>LocalRouter</h1><p>dashboard not built — run <code>scripts/build.sh</code></p>", 200));
}

export const VERSION = "0.1.0";
if (process.argv.includes("--version")) {
  console.log(`localrouter ${VERSION}`);
  process.exit(0); // brew/nix test hook, and CLI convention
}

const port = getConfig().port;
console.log(`[LocalRouter] core on 127.0.0.1:${port}`);
export default { port, hostname: "127.0.0.1", fetch: app.fetch }; // localhost-only (ADR-0003)
