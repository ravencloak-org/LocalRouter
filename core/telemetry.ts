// Anonymous, opt-out usage telemetry via Aptabase (privacy-first, no PII).
//
// OFF unless LR_APTABASE_APP_KEY is set. Additionally killed by DO_NOT_TRACK=1 or
// LR_TELEMETRY=0. We send ONLY aggregate numbers per request - model name + token
// counts + usd_saved (the API-equivalent cost the subscription covered). Never the
// prompt, the response, client tokens, or IPs (Aptabase stores no IP). See README.
//
// ponytail: raw REST, no SDK - Aptabase ships no server SDK and the ingest API is
// a single POST. Region host is derived from the App-Key prefix like the client SDKs.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { join } from "node:path";

// Project's own Aptabase app key, baked in so telemetry is ON BY DEFAULT for every install
// (opt-out model, Homebrew-style). Replace "" with the real A-US-/A-EU-/A-SH- key from
// aptabase.com. Users override with LR_APTABASE_APP_KEY (e.g. to self-host their own stats).
const DEFAULT_APP_KEY = "";

const KEY = process.env.LR_APTABASE_APP_KEY || DEFAULT_APP_KEY;

// host from the App-Key region: A-US-… / A-EU-… / A-SH-… (self-host needs LR_APTABASE_HOST)
function resolveHost(): string | undefined {
  const region = KEY?.split("-")[1];
  if (region === "US") return "https://us.aptabase.com";
  if (region === "EU") return "https://eu.aptabase.com";
  if (region === "SH") return process.env.LR_APTABASE_HOST; // self-hosted base URL
  return undefined;
}

const BASE = resolveHost();
export const telemetryEnabled =
  !!KEY && !!BASE && process.env.DO_NOT_TRACK !== "1" && process.env.LR_TELEMETRY !== "0";

// one Aptabase session per process start; unique users are derived server-side
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const APP_VERSION = process.env.LR_VERSION ?? "0.0.0";

// One-time opt-out notice, shown on first start where telemetry is actually on. A marker
// file in the config dir keeps it to once-per-install. No notice when telemetry is off.
export function noticeOnce(): void {
  if (!telemetryEnabled) return;
  const dir = process.env.LR_CONFIG_DIR ?? join(homedir(), ".config", "localrouter");
  const marker = join(dir, "telemetry-notice-shown");
  if (existsSync(marker)) return;
  console.log(
    "[LocalRouter] Anonymous usage stats are ON — model + token counts only, never prompts or content.\n" +
    "              Turn them off any time: DO_NOT_TRACK=1 or LR_TELEMETRY=0.  See README#telemetry.",
  );
  try { mkdirSync(dir, { recursive: true }); writeFileSync(marker, new Date().toISOString()); } catch { /* best effort */ }
}

// Fire-and-forget. Never blocks or throws into the request path.
export function track(eventName: string, props: Record<string, string | number | boolean>): void {
  if (!telemetryEnabled) return;
  const event = {
    timestamp: new Date().toISOString(),
    sessionId,
    eventName,
    systemProps: {
      isDebug: false,
      osName: platform(),
      osVersion: release(),
      locale: "en-US",
      appVersion: APP_VERSION,
      sdkVersion: "localrouter@1",
    },
    props,
  };
  fetch(`${BASE}/api/v0/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "App-Key": KEY! },
    body: JSON.stringify([event]), // batch endpoint takes an array
  }).catch(() => {}); // telemetry must never affect the request
}
