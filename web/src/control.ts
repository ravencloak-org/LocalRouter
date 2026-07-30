// fallow-ignore-file unused-file -- imported by App.ripple; fallow can't parse .ripple (not TS/JS)
// LocalRouter control API helpers.
// All /control/* requests need the X-LocalRouter CSRF header or the core returns 403.

export type Model = "sonnet" | "opus" | "haiku";
export type Effort = "low" | "medium" | "high";

export interface Status {
  running: boolean;
  loggedIn: boolean;
  model: Model;
  effort?: Effort;
  queueDepth: number;
  port: number;
  anthropicBaseUrl?: string;
}

async function ctl(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/control/${path}`, {
    ...init,
    headers: { "X-LocalRouter": "1", ...(init?.headers ?? {}) },
  });
}

export async function getStatus(): Promise<Status> {
  const r = await ctl("status");
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json() as Promise<Status>;
}

export interface ReqRecord {
  id: string;
  ts: number;
  model: string;
  stream: boolean;
  messages: unknown;
  response: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  httpStatus: number;
  errorType?: string;
}

export async function getRequest(id: string): Promise<ReqRecord> {
  const r = await ctl(`requests/${id}`);
  if (!r.ok) throw new Error(`request ${r.status}`);
  return r.json() as Promise<ReqRecord>;
}

export async function setConfig(
  cfg: { model?: Model; effort?: Effort; port?: number; anthropicBaseUrl?: string },
): Promise<void> {
  await ctl("config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
}

export async function login(): Promise<void> {
  await ctl("login", { method: "POST" });
}

export async function shutdown(): Promise<void> {
  await ctl("shutdown", { method: "POST" });
}
