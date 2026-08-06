import local from "../../public/stats.json";

export type Stats = {
  installs: number | null;
  tokensServed: number | null;
  usdSaved: number | null;
  updated: string | null;
};

// Build-time aggregate. Prefers a live published endpoint (PUBLIC_STATS_URL, generated from
// the self-hosted Aptabase) and falls back to the committed public/stats.json. Never invents
// numbers: a null field renders as an honest "collecting" state.
export async function getStats(): Promise<Stats> {
  const url = import.meta.env.PUBLIC_STATS_URL;
  if (url) {
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as Stats;
    } catch { /* fall back to local */ }
  }
  return local as Stats;
}

export function compact(n: number | null): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  const units = ["k", "M", "B"];
  let u = -1, v = n;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${units[u]}`;
}

export function usd(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `$${compact(n)}`;
  if (n < 1) return `$${n.toFixed(4)}`;      // sub-dollar: keep real precision
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
