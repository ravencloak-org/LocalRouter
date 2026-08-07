// LocalRouter Core. OpenAI-compatible HTTP -> claude CLI. Emits Events for the Dashboard.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "hono/bun";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { bus, uid } from "./bus";
import { runClaude, queueDepth, cliAlive, CliError, TimeoutError, type ClaudeResult } from "./claude";
import { getConfig, setConfig, type Effort, type Config } from "./config";
import { track, noticeOnce } from "./telemetry";
import type { LrEvent, OpenAIError } from "../shared/events";

const app = new Hono();
const now = () => Date.now();
const rid = () => crypto.randomUUID().slice(0, 8); // git-short-SHA style, no prefix
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

// Liveness/key-validation probe: system asks to echo a literal string, user sends it
// (e.g. Cognee's `respond with the following string: "test"`). We return the string directly
// instead of spawning `claude` — same answer, zero quota, no feed spam.
function healthEcho(messages: any[]): string | null {
  if (!Array.isArray(messages) || messages.length !== 2) return null;
  const sys = messages.find((m) => m.role === "system");
  const usr = messages.find((m) => m.role === "user");
  if (!sys || !usr) return null;
  const m = /with the following string:\s*"([^"]*)"\s*$/i.exec(String(sys.content).trim());
  return m && String(usr.content).trim() === m[1] ? m[1] : null;
}

function finishReq(requestId: string, client: string, model: string, t0: number, res: ClaudeResult) {
  // cost now rides on the request 'done' event — no separate span row cluttering the feed.
  emit({
    kind: "request", requestId, client, model, phase: "done", latencyMs: now() - t0,
    promptTokens: res.inputTokens, completionTokens: res.outputTokens, costUsd: res.costUsd, httpStatus: 200,
  });
}
function failReq(requestId: string, client: string, model: string, t0: number, httpStatus: number, errorType: string, detail: string) {
  emit({ kind: "request", requestId, client, model, phase: "error", latencyMs: now() - t0, httpStatus, errorType, preview: detail.slice(0, 120) });
  emit({ kind: "log", level: "error", msg: `${errorType}: ${detail.slice(0, 200)}`, requestId });
}

// Full request/response capture for the dashboard inspector (ngrok-style), persisted to
// SQLite so history survives restarts. Bounded to the most recent RECORDS_CAP rows.
type ReqRecord = {
  id: string; ts: number; client: string; model: string; stream: boolean;
  messages: unknown; response: string;
  promptTokens: number; completionTokens: number; costUsd: number;
  latencyMs: number; httpStatus: number; errorType?: string;
};
const DB_DIR = process.env.LR_CONFIG_DIR ?? join(homedir(), ".config", "localrouter");
mkdirSync(DB_DIR, { recursive: true });
const db = new Database(join(DB_DIR, "requests.db"));
db.run(
  `CREATE TABLE IF NOT EXISTS requests (
     id TEXT PRIMARY KEY, ts INTEGER, client TEXT, model TEXT, stream INTEGER, messages TEXT, response TEXT,
     promptTokens INTEGER, completionTokens INTEGER, costUsd REAL, latencyMs INTEGER,
     httpStatus INTEGER, errorType TEXT)`,
);
try { db.run(`ALTER TABLE requests ADD COLUMN client TEXT`); } catch { /* column exists */ }
const _insert = db.prepare(
  `INSERT OR REPLACE INTO requests
     (id,ts,client,model,stream,messages,response,promptTokens,completionTokens,costUsd,latencyMs,httpStatus,errorType)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
const _get = db.prepare(`SELECT * FROM requests WHERE id = ?`);

// usage: numeric rows only (no messages/response), kept long-term for analytics so token/cost
// history survives the heavy `requests` pruning. "Calculate before deleting" == this table.
db.run(
  `CREATE TABLE IF NOT EXISTS usage (
     id TEXT PRIMARY KEY, ts INTEGER, client TEXT, model TEXT,
     promptTokens INTEGER, completionTokens INTEGER, costUsd REAL, latencyMs INTEGER, httpStatus INTEGER)`,
);
db.run(`CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts)`);
db.run(`CREATE INDEX IF NOT EXISTS usage_client ON usage(client)`);
const _usageIns = db.prepare(
  `INSERT OR REPLACE INTO usage (id,ts,client,model,promptTokens,completionTokens,costUsd,latencyMs,httpStatus)
   VALUES (?,?,?,?,?,?,?,?,?)`,
);
const RECORDS_CAP = 2000; // full req/resp (heavy) for the inspector
const USAGE_CAP = 200000; // numeric usage rows (light) for analytics
function putRecord(r: ReqRecord) {
  _insert.run(r.id, r.ts, r.client, r.model, r.stream ? 1 : 0, JSON.stringify(r.messages), r.response,
    r.promptTokens, r.completionTokens, r.costUsd, r.latencyMs, r.httpStatus, r.errorType ?? null);
  _usageIns.run(r.id, r.ts, r.client, r.model, r.promptTokens, r.completionTokens, r.costUsd, r.latencyMs, r.httpStatus);
  db.run(`DELETE FROM requests WHERE id NOT IN (SELECT id FROM requests ORDER BY ts DESC LIMIT ?)`, [RECORDS_CAP]);
  db.run(`DELETE FROM usage WHERE id NOT IN (SELECT id FROM usage ORDER BY ts DESC LIMIT ?)`, [USAGE_CAP]);
}

// Analytics over the usage table (survives request pruning).
function windowStats(sinceMs: number) {
  return db
    .query(
      `SELECT count(*) requests, coalesce(sum(promptTokens),0) promptTokens,
              coalesce(sum(completionTokens),0) completionTokens, coalesce(sum(costUsd),0) costUsd
       FROM usage WHERE ts >= ?`,
    )
    .get(sinceMs);
}
function byClientStats(sinceMs: number) {
  return db
    .query(
      `SELECT client, count(*) requests, coalesce(sum(promptTokens),0) promptTokens,
              coalesce(sum(completionTokens),0) completionTokens, coalesce(sum(costUsd),0) costUsd
       FROM usage WHERE ts >= ? GROUP BY client ORDER BY costUsd DESC`,
    )
    .all(sinceMs);
}
function getRecord(id: string): ReqRecord | undefined {
  const row = _get.get(id) as any;
  if (!row) return undefined;
  return { ...row, stream: !!row.stream, messages: JSON.parse(row.messages), errorType: row.errorType ?? undefined };
}

// --- Client tokens: map a bearer token -> client name, to tag & filter requests. ---
db.run(`CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, name TEXT, created INTEGER)`);
const _tokIns = db.prepare(`INSERT INTO tokens (token,name,created) VALUES (?,?,?)`);
const _tokList = db.prepare(`SELECT token,name,created FROM tokens ORDER BY created DESC`);
const _tokDel = db.prepare(`DELETE FROM tokens WHERE token = ?`);
const _tokName = db.prepare(`SELECT name FROM tokens WHERE token = ?`);
const _tokByName = db.prepare(`SELECT token,name FROM tokens WHERE name = ?`);
db.run(`DELETE FROM tokens WHERE rowid NOT IN (SELECT min(rowid) FROM tokens GROUP BY name)`); // dedupe first
db.run(`CREATE UNIQUE INDEX IF NOT EXISTS tokens_name ON tokens(name)`); // names are unique
const REQUIRE_TOKEN = process.env.LR_REQUIRE_TOKEN === "1"; // reject unregistered tokens
function createToken(name: string) {
  const existing = _tokByName.get(name) as { token: string; name: string } | undefined;
  if (existing) return existing; // unique name -> idempotent (return the same token)
  const token = "sk-lr-" + crypto.randomUUID().replace(/-/g, "");
  _tokIns.run(token, name, Date.now());
  return { token, name };
}
function clientForToken(auth: string | undefined): string | null {
  const t = auth?.replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  const row = _tokName.get(t) as { name?: string } | undefined;
  return row?.name ?? null;
}

app.get("/healthz", async (c) => {
  const ok = await cliAlive();
  return c.json({ status: ok ? "ok" : "cli_unavailable", queueDepth: queueDepth() }, ok ? 200 : 503);
});

app.get("/v1/models", (c) =>
  c.json({ object: "list", data: ["sonnet", "opus", "haiku"].map((id) => ({ id, object: "model", owned_by: "anthropic" })) }));

app.post("/v1/embeddings", (c) =>
  c.json(errBody("No embeddings on the claude CLI. Route EMBEDDING_* to TEI / OpenAI / Voyage.", "unsupported"), 400));

app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.messages?.length) return c.json(errBody("`messages` required", "invalid_request_error"), 400);

  // Echo liveness/key-validation probes without spawning claude (saves quota, no feed spam).
  // Opt out with LR_NO_ECHO=1.
  const echo = process.env.LR_NO_ECHO ? null : healthEcho(body.messages);
  if (echo !== null && !body.stream) {
    emit({ kind: "log", level: "debug", msg: `health-check echoed "${echo}" (no LLM call)` });
    return c.json({
      id: chatId(),
      object: "chat.completion",
      created: Math.floor(now() / 1000),
      model: body.model ?? "claude",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: echo } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  const client = clientForToken(c.req.header("authorization")) ?? "unknown";
  const requestId = rid();
  const model = body.model ?? "claude";
  const wantStream = !!body.stream;
  const { system, prompt } = flatten(body.messages);
  const t0 = now();

  if (REQUIRE_TOKEN && client === "unknown") {
    // surface the 401 as a request row (not silent)
    emit({ kind: "request", requestId, client, model, phase: "queued", queueWaitMs: 0 });
    failReq(requestId, client, model, t0, 401, "invalid_api_key", "unknown or missing client token");
    putRecord({ id: requestId, ts: t0, client, model, stream: wantStream, messages: body.messages,
      response: "unknown or missing client token (LR_REQUIRE_TOKEN)", promptTokens: 0, completionTokens: 0,
      costUsd: 0, latencyMs: 0, httpStatus: 401, errorType: "invalid_api_key" });
    return c.json(errBody("unknown or missing client token (LR_REQUIRE_TOKEN)", "invalid_api_key"), 401);
  }

  emit({ kind: "request", requestId, client, model, phase: "queued", queueWaitMs: 0 });

  if (wantStream) {
    return streamSSE(c, async (ss) => {
      const id = chatId();
      const created = Math.floor(now() / 1000);
      let full = "";
      try {
        const gen = runClaude(system, prompt,
          () => emit({ kind: "request", requestId, client, model, phase: "streaming" }));
        let r = await gen.next();
        while (!r.done) {
          full += r.value;
          // note: no per-token /events broadcast — the dashboard never renders deltas
          // (App.ripple drops kind:"token"), and it floods subscribers / hangs the UI scroll.
          await ss.writeSSE({
            data: JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: r.value }, finish_reason: null }] }),
          });
          r = await gen.next();
        }
        await ss.writeSSE({ data: JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) });
        await ss.writeSSE({ data: "[DONE]" });
        finishReq(requestId, client, model, t0, r.value);
        putRecord({ id: requestId, ts: t0, client, model, stream: true, messages: body.messages, response: full || r.value.text,
          promptTokens: r.value.inputTokens, completionTokens: r.value.outputTokens, costUsd: r.value.costUsd, latencyMs: now() - t0, httpStatus: 200 });
        track("request", { model, tokens_in: r.value.inputTokens, tokens_out: r.value.outputTokens, usd_saved: r.value.costUsd });
      } catch (err) {
        const [status, type, detail] = classify(err);
        failReq(requestId, client, model, t0, status, type, detail);
        putRecord({ id: requestId, ts: t0, client, model, stream: true, messages: body.messages, response: full || detail,
          promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: now() - t0, httpStatus: status, errorType: type });
        await ss.writeSSE({ data: JSON.stringify(errBody(detail, type)) });
        await ss.writeSSE({ data: "[DONE]" });
      }
    });
  }

  // non-stream: drain generator, return one complete chat.completion
  try {
    const gen = runClaude(system, prompt,
      () => emit({ kind: "request", requestId, client, model, phase: "spawning" }));
    let r = await gen.next();
    while (!r.done) r = await gen.next();
    const res = r.value;
    finishReq(requestId, client, model, t0, res);
    putRecord({ id: requestId, ts: t0, client, model, stream: false, messages: body.messages, response: res.text,
      promptTokens: res.inputTokens, completionTokens: res.outputTokens, costUsd: res.costUsd, latencyMs: now() - t0, httpStatus: 200 });
    track("request", { model, tokens_in: res.inputTokens, tokens_out: res.outputTokens, usd_saved: res.costUsd });
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
    failReq(requestId, client, model, t0, status, type, detail);
    putRecord({ id: requestId, ts: t0, client, model, stream: false, messages: body.messages, response: detail,
      promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: now() - t0, httpStatus: status, errorType: type });
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

// Full request/response for the dashboard inspector (ngrok-style row expand).
app.get("/control/requests/:id", (c) => {
  const r = getRecord(c.req.param("id"));
  return r ? c.json(r) : c.json(errBody("no record for that id", "not_found"), 404);
});

// Client tokens: create one per client (cognee, continue, ...), use it as the OpenAI api_key,
// and requests get tagged with the client name for filtering.
app.get("/control/tokens", (c) => c.json(_tokList.all()));
app.post("/control/tokens", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = (b.name ?? "").trim() || "client";
  return c.json(createToken(name));
});
app.delete("/control/tokens/:token", (c) => {
  _tokDel.run(c.req.param("token"));
  return c.json({ ok: true });
});

// Usage analytics: token/cost per time window + per client (from the durable `usage` table).
app.get("/control/usage", (c) => {
  const t = Date.now(), h = 3600e3, d = 24 * h, w = 7 * d;
  return c.json({
    windows: { "1h": windowStats(t - h), "24h": windowStats(t - d), "7d": windowStats(t - w), all: windowStats(0) },
    byClient: byClientStats(t - w), // last 7d, per client
  });
});

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
  // Real auth = `claude setup-token` (OAuth for the subscription). NOT `claude login`
  // (that isn't a command). It needs a TTY + browser, so open it in a terminal.
  const cmd = "claude setup-token";
  if (process.platform === "darwin") {
    Bun.spawn(["osascript", "-e", `tell application "Terminal" to do script "${cmd}"`, "-e", `tell application "Terminal" to activate`]);
  } else if (process.platform === "win32") {
    Bun.spawn(["cmd", "/c", "start", "cmd", "/k", cmd]);
  } else {
    Bun.spawn(["x-terminal-emulator", "-e", "sh", "-lc", cmd]);
  }
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
  join(import.meta.dir, "..", "web", "dist"), // dev: server.ts lives in core/, dist is a sibling — cwd-independent (dev script cd's into core/)
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

// Stamped at compile time via `bun build --define process.env.LR_VERSION='"X.Y.Z"'`
// (release CI, build-app.sh, build.sh). Unstamped dev builds report 0.0.0-dev.
export const VERSION = process.env.LR_VERSION ?? "0.0.0-dev";
if (process.argv.includes("--version")) {
  console.log(`localrouter ${VERSION}`);
  process.exit(0); // brew/nix test hook, and CLI convention
}

// `localrouter token <create|list|rm>` — mint/manage /v1 client tokens from the CLI so a
// headless or containerized deploy can issue tokens without the dashboard. Writes to the same
// SQLite the running server reads (LR_CONFIG_DIR), so a new token is honored immediately.
if (process.argv[2] === "token") {
  const sub = process.argv[3];
  const rest = process.argv.slice(4);
  const has = (f: string) => rest.includes(f);
  const val = (f: string) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
  if (sub === "create" || sub === "new") {
    const name = val("--name") ?? rest.find((a) => !a.startsWith("-"));
    if (!name) { console.error("usage: localrouter token create --name <name> [--quiet|--export]"); process.exit(2); }
    const { token } = createToken(name); // idempotent by name
    if (has("--export")) {
      // eval "$(localrouter token create --name x --export)" sets LR_TOKEN in the current shell
      console.log(`export LR_TOKEN=${token}`);
    } else if (has("--quiet")) {
      console.log(token); // token only, for LR_TOKEN=$(... --quiet)
    } else {
      console.log(token);
      console.error(`\nToken '${name}' created. Send it as the OpenAI API key: Authorization: Bearer ${token}`);
      console.error(`Enforce it by starting the server with LR_REQUIRE_TOKEN=1.`);
      console.error(`Tip: eval "$(localrouter token create --name ${name} --export)"  # sets $LR_TOKEN`);
    }
    process.exit(0);
  }
  if (sub === "list" || sub === "ls") {
    for (const r of _tokList.all() as Array<{ token: string; name: string; created: number }>)
      console.log(`${r.token}\t${r.name}\t${new Date(r.created).toISOString()}`);
    process.exit(0);
  }
  if (sub === "rm" || sub === "delete") {
    if (!rest[0]) { console.error("usage: localrouter token rm <token>"); process.exit(2); }
    _tokDel.run(rest[0]);
    console.error(`removed ${rest[0]}`);
    process.exit(0);
  }
  console.error("usage: localrouter token <create --name NAME [--quiet|--export] | list | rm TOKEN>");
  process.exit(2);
}

const port = getConfig().port;
// localhost-only (ADR-0003) but dual-stack: bind IPv4 127.0.0.1 AND IPv6 ::1 so clients that
// resolve `localhost` to ::1 (macOS default) can still reach us. Fixes "unreachable" for
// litellm/httpx clients like Cognee.
// LR_HOST overrides the bind for containerized runs (Docker needs 0.0.0.0 to be port-mappable);
// leave it unset for host installs so we stay localhost-only.
const host = process.env.LR_HOST ?? "127.0.0.1";
Bun.serve({ port, hostname: host, fetch: app.fetch });
if (host === "127.0.0.1") {
  try {
    Bun.serve({ port, hostname: "::1", fetch: app.fetch });
  } catch { /* IPv6 unavailable — IPv4 still serves */ }
}
console.log(`[LocalRouter] core on ${host}:${port}${host === "127.0.0.1" ? " (127.0.0.1 + ::1)" : ""}`);
noticeOnce(); // one-time anonymous-telemetry opt-out notice (no-op when telemetry is off)
