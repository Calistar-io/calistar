/** Configuration, read once from the environment. A missing required value stops the process. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function port(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

const trimSlash = (url: string): string => url.trim().replace(/\/+$/, "");

export interface Config {
  /** Public listener: ingestion from tenants. */
  publicPort: number;
  /** Private listener: the Collector's reduced output. Never published outside the network. */
  privatePort: number;
  databaseUrl: string;
  /** One URL per Collector replica, on the private network. */
  collectorUrls: string[];
  /** Umami, on the private network. */
  umamiUrl: string;
  tenantsFile: string;
  /** Largest request body accepted on the public listener, in bytes. */
  maxBodyBytes: number;
  /** Proxies in front of the gateway that append to X-Forwarded-For. 0: the TCP peer is the client. */
  trustedProxyHops: number;
}

export function loadConfig(): Config {
  return {
    publicPort: port("GATEWAY_PUBLIC_PORT", 8080),
    privatePort: port("GATEWAY_PRIVATE_PORT", 8081),
    databaseUrl: required("DATABASE_URL"),
    collectorUrls: required("COLLECTOR_URLS").split(",").map(trimSlash).filter(Boolean),
    umamiUrl: trimSlash(required("UMAMI_URL")),
    tenantsFile: required("TENANTS_FILE"),
    maxBodyBytes: 4 * 1024 * 1024,
    trustedProxyHops: Math.max(0, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "0", 10) || 0),
  };
}
