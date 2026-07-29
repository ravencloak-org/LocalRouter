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
    return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS }; // missing/corrupt file -> defaults
  }
}

export function setConfig(patch: Partial<Config>): Config {
  const next = { ...getConfig(), ...patch };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}
