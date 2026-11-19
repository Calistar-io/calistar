import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { ROW_CEILING, type MetricRow } from "./otlp-metrics.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const MIGRATION_LOCK = 727001;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Applies the SQL files of migrations/ that have not run yet, in name order, each in a transaction. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // One instance migrates at a time: the others wait here, then find nothing left to do.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migration")).rows.map((r) => r.name));
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(MIGRATIONS_DIR + file, "utf8"));
        await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return applied;
}

const COLUMNS = 10;

/**
 * Adds rows to the hourly aggregates. A row that exists is incremented: counts, duration and
 * each bucket are summed. `rows` must hold one row per key, which `aggregate` guarantees.
 *
 * Sums saturate at ROW_CEILING instead of overflowing: an overflow would make PostgreSQL refuse
 * the whole statement, and one tenant's row could then drop the rows of every other tenant in
 * the batch.
 */
export async function upsertRows(pool: pg.Pool, rows: readonly MetricRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const tuples = rows.map((row, i) => {
    values.push(
      row.tenantId,
      row.serviceId,
      row.direction,
      row.method,
      row.route,
      row.statusCode,
      row.hour,
      row.requestCount,
      row.durationSumMs,
      row.bucketCounts,
    );
    const p = (n: number) => "$" + (i * COLUMNS + n);
    return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}::timestamptz, ${p(8)}, ${p(9)}, ${p(10)}::bigint[])`;
  });
  await pool.query(
    `INSERT INTO api_metric_1h AS m
       (tenant_id, service_id, direction, method, route, status_code, hour, request_count, duration_sum_ms, bucket_counts)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (tenant_id, service_id, direction, method, route, status_code, hour) DO UPDATE SET
       request_count = LEAST(m.request_count::numeric + EXCLUDED.request_count, ${ROW_CEILING})::bigint,
       duration_sum_ms = LEAST(m.duration_sum_ms + EXCLUDED.duration_sum_ms, 1e18),
       bucket_counts = (
         SELECT array_agg(LEAST(COALESCE(a, 0)::numeric + COALESCE(b, 0), ${ROW_CEILING})::bigint ORDER BY i)
         FROM unnest(m.bucket_counts, EXCLUDED.bucket_counts) WITH ORDINALITY AS t (a, b, i)
       )`,
    values,
  );
}
