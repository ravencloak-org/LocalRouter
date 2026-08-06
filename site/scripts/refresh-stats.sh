#!/usr/bin/env bash
# Query the self-hosted Aptabase ClickHouse for LocalRouter's aggregate telemetry and
# write site/public/stats.json. Run on a cron (or in the site's deploy) to refresh.
set -euo pipefail
VPS="${LR_STATS_VPS:-root@192.46.208.99}"
CH_PW="${LR_STATS_CH_PW:?set LR_STATS_CH_PW}"
OUT="$(dirname "$0")/../public/stats.json"
SQL="SELECT uniqExact(user_id) AS installs, toUInt64(sum(JSONExtractInt(numeric_props,'tokens_in'))+sum(JSONExtractInt(numeric_props,'tokens_out'))) AS tokensServed, round(sum(JSONExtractFloat(numeric_props,'usd_saved')),4) AS usdSaved FROM default.events WHERE event_name='request' AND app_id NOT LIKE '%_DEBUG' FORMAT JSONEachRow"
ROW=$(ssh -o BatchMode=yes "$VPS" "docker exec -i \$(docker ps --format '{{.Names}}' | grep events_db | head -1) clickhouse-client -u aptabase --password '$CH_PW' --query \"$SQL\"")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "${ROW%\}}, \"updated\":\"$NOW\"}" > "$OUT"
cat "$OUT"
