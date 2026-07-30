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
  client: string;
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

export interface Token {
  token: string;
  name: string;
  created: number;
}
export async function listTokens(): Promise<Token[]> {
  const r = await ctl("tokens");
  return r.ok ? (r.json() as Promise<Token[]>) : [];
}
export async function createToken(name: string): Promise<{ token: string; name: string }> {
  const r = await ctl("tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return r.json() as Promise<{ token: string; name: string }>;
}
export async function revokeToken(token: string): Promise<void> {
  await ctl(`tokens/${encodeURIComponent(token)}`, { method: "DELETE" });
}

export interface UsageWindow {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}
export interface ClientUsage extends UsageWindow {
  client: string;
}
export interface Usage {
  windows: { "1h": UsageWindow; "24h": UsageWindow; "7d": UsageWindow; all: UsageWindow };
  byClient: ClientUsage[];
}
export async function getUsage(): Promise<Usage> {
  const r = await ctl("usage");
  if (!r.ok) throw new Error(`usage ${r.status}`);
  return r.json() as Promise<Usage>;
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
