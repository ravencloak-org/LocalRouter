// Spawn the real `claude` CLI, parse stream-json, enforce bounded concurrency.
// ADR-0002: we drive the genuine CLI (it self-auths); we never touch the OAuth token.

const MODEL = process.env.LR_MODEL ?? "sonnet";
const N = Number(process.env.LR_CONCURRENCY ?? 4); // bounded semaphore (PLAN.md)
const TIMEOUT_MS = Number(process.env.LR_TIMEOUT_MS ?? 300_000);

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

export type ClaudeResult = { text: string; inputTokens: number; outputTokens: number };

// Yields text deltas as they arrive; returns final result + usage.
// Non-stream callers drain the generator and use the return value.
export async function* runClaude(
  system: string,
  prompt: string,
): AsyncGenerator<string, ClaudeResult> {
  await acquire();
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", MODEL];
  if (system) args.push("--append-system-prompt", system);
  // prompt via stdin: no shell, no arg-length limit, no injection
  const proc = Bun.spawn(["claude", ...args], {
    stdin: Buffer.from(prompt),
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

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
        // ponytail: stream-json schema varies by claude version. Verify the event
        // `type` values + usage key paths against your installed CLI; drift -> parse_error.
        if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
          for (const c of ev.message.content) {
            if (c.type === "text" && c.text) {
              text += c.text;
              yield c.text;
            }
          }
        } else if (ev.type === "result") {
          if (typeof ev.result === "string") text = ev.result;
          inputTokens = ev.usage?.input_tokens ?? inputTokens;
          outputTokens = ev.usage?.output_tokens ?? outputTokens;
        }
      }
    }
    const code = await proc.exited;
    if (timedOut) throw new TimeoutError();
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new CliError(code, stderr.slice(0, 500));
    }
    return { text, inputTokens, outputTokens };
  } finally {
    clearTimeout(killer);
    release();
  }
}

// Cheap liveness probe for /healthz. ponytail: version-only; a real auth probe costs
// tokens, so we treat the first request-time 503/auth error as the auth signal instead.
export async function cliAlive(): Promise<boolean> {
  const proc = Bun.spawn(["claude", "--version"], { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}
