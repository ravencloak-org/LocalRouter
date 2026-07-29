// Shared runtime config, read live per request. Tray, dashboard, and CLI all read/write
// this one file (ADR-0003). Changing model/effort takes effect on the next request — no restart.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Effort = "low" | "medium" | "high";
export type Config = { model: string; effort?: Effort; port: number };

const DIR = process.env.LR_CONFIG_DIR ?? join(homedir(), ".config", "localrouter");
const FILE = join(DIR, "config.json");
const DEFAULTS: Config = {
  model: process.env.LR_MODEL ?? "sonnet",
  effort: (process.env.LR_EFFORT as Effort) || undefined,
  port: Number(process.env.LR_PORT ?? 8083),
};

export function getConfig(): Config {
  try {
    const file = JSON.parse(readFileSync(FILE, "utf8"));
    // port is boot-time only (env/default); never let the persisted file override the
    // bound port. Only model/effort are runtime-tunable via the file.
    return { ...DEFAULTS, model: file.model ?? DEFAULTS.model, effort: file.effort ?? DEFAULTS.effort };
  } catch {
    return { ...DEFAULTS }; // missing/corrupt file -> defaults
  }
}

export function setConfig(patch: Partial<Config>): Config {
  const next = getConfig();
  if (patch.model) next.model = patch.model;
  if ("effort" in patch) next.effort = patch.effort;
  mkdirSync(DIR, { recursive: true });
  // persist only the runtime-tunable fields (not port)
  writeFileSync(FILE, JSON.stringify({ model: next.model, effort: next.effort }, null, 2));
  return next;
}
