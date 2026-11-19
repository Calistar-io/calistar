/**
 * Access to the running local stack: where each service answers, what is stored, what was logged.
 * Defaults match infra/compose/compose.yaml with compose.test.yaml.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const env = (name: string, fallback: string): string => process.env[name] || fallback;

export const GATEWAY_URL = env("GATEWAY_URL", "http://127.0.0.1:8080");
export const UMAMI_URL = env("UMAMI_URL", "http://127.0.0.1:13000");
export const EXAMPLE_SITE_URL = env("EXAMPLE_SITE_URL", "http://127.0.0.1:8091");
export const EXAMPLE_API_URL = env("EXAMPLE_API_URL", "http://127.0.0.1:8090");

const PG_HOST = env("POSTGRES_HOST", "127.0.0.1");
const PG_PORT = env("POSTGRES_TEST_PORT", "15432");
export const CALISTAR_DB = env("CALISTAR_DATABASE_URL", `postgresql://calistar:local-calistar@${PG_HOST}:${PG_PORT}/calistar`);
export const UMAMI_DB = env("UMAMI_DATABASE_URL", `postgresql://umami:local-umami@${PG_HOST}:${PG_PORT}/umami`);

/** Local test tokens. Their digests are in infra/compose/seed/tenants.json. */
export const TOKEN_A = "calistar-poc-token-tenant-a";
export const TOKEN_B = "calistar-poc-token-tenant-b";

const COMPOSE_DIR = fileURLToPath(new URL("../../../infra/compose/", import.meta.url));
const COMPOSE_FILES = ["-f", `${COMPOSE_DIR}compose.yaml`, "-f", `${COMPOSE_DIR}compose.test.yaml`];
/** The four services that make up Calistar. The example site and API are the tenant's side. */
export const CALISTAR_SERVICES = ["postgres", "collector", "umami", "gateway"];

/** Runs `docker compose <args>` on the stack and returns its standard output. */
export function compose(...args: string[]): string {
  return execFileSync(env("DOCKER", "docker"), ["compose", ...COMPOSE_FILES, ...args], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** A plain-SQL dump of both databases: every row of every table, as text. */
export function dumpDatabases(): string {
  return ["umami", "calistar"].map((db) => compose("exec", "-T", "postgres", "pg_dump", "-U", "postgres", "--inserts", db)).join("\n");
}

/** Everything Calistar's services have logged since they started. */
export function serviceLogs(): string {
  return compose("logs", "--no-color", "--no-log-prefix", ...CALISTAR_SERVICES);
}

/** Dumps and logs together: the places where a value that must not be kept could have ended up. */
export function everythingKept(): string {
  return `${dumpDatabases()}\n${serviceLogs()}`;
}

export async function query<T extends pg.QueryResultRow>(databaseUrl: string, sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, values)).rows;
  } finally {
    await client.end();
  }
}

/** Row count of every table of a database, by table name. */
export async function tableCounts(databaseUrl: string): Promise<Record<string, number>> {
  const tables = await query<{ table_name: string }>(
    databaseUrl,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const [row] = await query<{ n: string }>(databaseUrl, `SELECT count(*) AS n FROM "${table_name}"`);
    counts[table_name] = Number(row!.n);
  }
  return counts;
}

/** Waits until `probe` returns a value, or fails after `timeoutMs`. */
export async function eventually<T>(probe: () => Promise<T | undefined | null | false>, what: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A short random word that no normalization rule matches: safe to use as a route segment. */
export const runId = (): string => `run${Math.random().toString(36).slice(2, 8).replace(/\d/g, "x")}`;
