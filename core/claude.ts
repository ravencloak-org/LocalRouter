// Spawn the real `claude` CLI, parse stream-json, enforce bounded concurrency.
// ADR-0002: we drive the genuine CLI (it self-auths); we never touch the OAuth token.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig } from "./config";

const N = Number(process.env.LR_CONCURRENCY ?? 8); // bounded semaphore (PLAN.md)
const TIMEOUT_MS = Number(process.env.LR_TIMEOUT_MS ?? 300_000);

// Isolation: strip Claude Code's agent context so each spawn is a lean LLM call, not a
// full coding-agent session. Measured 161K -> ~181 tokens/call, $0.92 -> $0.0006, OAuth intact.
// (--bare is NOT used: it forces ANTHROPIC_API_KEY and disables OAuth, breaking ADR-0002.)
const ISOLATED = process.env.LR_ISOLATED !== "0"; // default on

// The CLI command to spawn (default "claude"). Whitespace-split so it can carry a wrapper +
// fixed flags — e.g. LR_CLAUDE_BIN="/opt/bin/claude", "npx @anthropic-ai/claude-code", or a
// gateway wrapper script. Pair with ANTHROPIC_BASE_URL (config/dashboard) to redirect upstream.
const CLAUDE_BIN = (process.env.LR_CLAUDE_BIN ?? "claude").split(/\s+/).filter(Boolean);
const ISO_DIR = mkdtempSync(join(tmpdir(), "localrouter-")); // empty cwd: no CLAUDE.md discovery
const EMPTY_MCP = join(ISO_DIR, "empty-mcp.json");
writeFileSync(EMPTY_MCP, '{"mcpServers":{}}');
const DEFAULT_SYSTEM = "You are a helpful assistant.";

// --- bounded semaphore, FIFO overflow ---
let active = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (active < N) {
    active++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}
export const queueDepth = () => waiters.length;

export class CliError extends Error {
  constructor(public code: number, public stderr: string) {
    super(`claude exit ${code}`);
  }
}
export class TimeoutError extends Error {
  constructor() {
    super("timeout");
  }
}

export type ClaudeResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

// Yields text deltas as they arrive; returns final result + usage.
// Non-stream callers drain the generator and use the return value.
export async function* runClaude(
  system: string,
  prompt: string,
  onSpawn?: () => void, // fired once a semaphore slot is won, before spawn — lets callers show a real queued->spawning transition
): AsyncGenerator<string, ClaudeResult> {
  await acquire();
  onSpawn?.();
  const { model, effort, anthropicBaseUrl } = getConfig(); // live: dashboard changes apply next request
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", model];
  if (effort) args.push("--effort", effort); // level selector: low|medium|high
  if (ISOLATED) {
    // Replace the default agent prompt with the caller's system message (OpenAI semantics),
    // and strip MCP tools / user hooks / built-in tools / CLAUDE.md discovery.
    args.push(
      "--system-prompt", system || DEFAULT_SYSTEM,
      "--strict-mcp-config", "--mcp-config", EMPTY_MCP,
      "--setting-sources", "project", // from ISO_DIR (empty) -> loads nothing
      "--tools", "", // no built-in tool schemas
    );
  } else if (system) {
    args.push("--append-system-prompt", system);
  }
  // prompt via stdin: no shell, no arg-length limit, no injection
  const proc = Bun.spawn([...CLAUDE_BIN, ...args], {
    stdin: Buffer.from(prompt),
    stdout: "pipe",
    stderr: "pipe",
    cwd: ISOLATED ? ISO_DIR : undefined, // neutral cwd: no project/parent CLAUDE.md
    // route the CLI at a custom Anthropic endpoint (gateway/OpenRouter/mock) when configured
    env: anthropicBaseUrl ? { ...process.env, ANTHROPIC_BASE_URL: anthropicBaseUrl } : undefined,
  });

  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  try {
    const reader = proc.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue; // ponytail: tolerate non-JSON noise lines
        }
        // Schema verified against claude 2.1.206 stream-json:
        //   assistant -> .message.content[] {type:"text", text}
        //   result    -> .result (string), .usage.{input_tokens,output_tokens,
        //                cache_read_input_tokens,cache_creation_input_tokens}, .total_cost_usd,
        //                .is_error / .subtype
        // ponytail: keys may drift across claude versions -> parse_error path.
        if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
          for (const c of ev.message.content) {
            if (c.type === "text" && c.text) {
              text += c.text;
              yield c.text;
            }
          }
        } else if (ev.type === "result") {
          // claude can exit 0 with an errored result — surface it as an upstream failure.
          if (ev.is_error || (ev.subtype && ev.subtype !== "success")) {
            throw new CliError(0, String(ev.result ?? ev.api_error_status ?? "claude result error").slice(0, 500));
          }
          if (typeof ev.result === "string") text = ev.result;
          inputTokens = ev.usage?.input_tokens ?? inputTokens;
          outputTokens = ev.usage?.output_tokens ?? outputTokens;
          costUsd = ev.total_cost_usd ?? costUsd;
          cacheReadTokens = ev.usage?.cache_read_input_tokens ?? cacheReadTokens;
          cacheCreationTokens = ev.usage?.cache_creation_input_tokens ?? cacheCreationTokens;
        }
        // ponytail: `rate_limit_event` type is emitted too — ignored for now;
        // wire it to pool backoff + a Dashboard backpressure signal later.
      }
    }
    const code = await proc.exited;
    if (timedOut) throw new TimeoutError();
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new CliError(code, stderr.slice(0, 500));
    }
    return { text, inputTokens, outputTokens, costUsd, cacheReadTokens, cacheCreationTokens };
  } finally {
    clearTimeout(killer);
    release();
  }
}

// Cheap liveness probe for /healthz. ponytail: version-only; a real auth probe costs
// tokens, so we treat the first request-time 503/auth error as the auth signal instead.
export async function cliAlive(): Promise<boolean> {
  try {
    const proc = Bun.spawn([...CLAUDE_BIN, "--version"], { stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false; // `claude` not on PATH (e.g. under launchd) -> clean 503, not a 500
  }
}
