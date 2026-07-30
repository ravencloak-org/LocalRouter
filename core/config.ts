// Shared runtime config, read live per request. Tray, dashboard, and CLI all read/write
// this one file (ADR-0003). Changing model/effort takes effect on the next request — no restart.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Effort = "low" | "medium" | "high";
export type Config = { model: string; effort?: Effort; port: number; anthropicBaseUrl?: string };

const DIR = process.env.LR_CONFIG_DIR ?? join(homedir(), ".config", "localrouter");
const FILE = join(DIR, "config.json");
const ENV_PORT = process.env.LR_PORT ? Number(process.env.LR_PORT) : undefined;
const DEFAULTS: Config = {
  model: process.env.LR_MODEL ?? "sonnet",
  effort: (process.env.LR_EFFORT as Effort) || undefined,
  port: ENV_PORT ?? 8083,
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
};

export function getConfig(): Config {
  try {
    const file = JSON.parse(readFileSync(FILE, "utf8"));
    // port precedence: env LR_PORT (explicit) > persisted file.port > default. Env always
    // wins so a stale file can't hijack an explicit LR_PORT. The bound port only changes
    // on restart (server binds once); the dashboard writes file.port and prompts a restart.
    return {
      model: file.model ?? DEFAULTS.model,
      effort: file.effort ?? DEFAULTS.effort,
      port: ENV_PORT ?? file.port ?? 8083,
      // env ANTHROPIC_BASE_URL wins; else persisted; else CLI default (unset)
      anthropicBaseUrl: DEFAULTS.anthropicBaseUrl ?? file.anthropicBaseUrl ?? undefined,
    };
  } catch {
    return { ...DEFAULTS }; // missing/corrupt file -> defaults
  }
}

export function setConfig(patch: Partial<Config>): Config {
  const next = getConfig();
  if (patch.model) next.model = patch.model;
  if ("effort" in patch) next.effort = patch.effort;
  if (patch.port) next.port = patch.port; // takes effect on next core restart
  if ("anthropicBaseUrl" in patch) next.anthropicBaseUrl = patch.anthropicBaseUrl || undefined;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    FILE,
    JSON.stringify({ model: next.model, effort: next.effort, port: next.port, anthropicBaseUrl: next.anthropicBaseUrl }, null, 2),
  );
  return next;
}
