/**
 * Ingest tokens. In the proof of concept they come from a seed file; the control plane replaces
 * it later. Only SHA-256 digests are kept: a token is looked up by the digest of what the caller
 * presents, so the plain value is never compared or held.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export interface IngestBinding {
  tenantId: string;
  serviceId: string;
}

interface SeedFile {
  tenants: { id: string; services: { id: string; tokenSha256: string }[] }[];
}

export const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

export class TokenRegistry {
  private readonly byDigest = new Map<string, IngestBinding>();

  constructor(bindings: Iterable<[tokenSha256: string, binding: IngestBinding]>) {
    for (const [digest, binding] of bindings) this.byDigest.set(digest.toLowerCase(), binding);
  }

  static fromFile(path: string): TokenRegistry {
    const seed = JSON.parse(readFileSync(path, "utf8")) as SeedFile;
    const bindings: [string, IngestBinding][] = [];
    for (const tenant of seed.tenants) {
      for (const service of tenant.services) {
        bindings.push([service.tokenSha256, { tenantId: tenant.id, serviceId: service.id }]);
      }
    }
    return new TokenRegistry(bindings);
  }

  /** The tenant and service a bearer token writes for, or `undefined`. */
  resolve(authorization: string | undefined): IngestBinding | undefined {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    if (!match) return undefined;
    return this.byDigest.get(sha256Hex(match[1]!));
  }

  get size(): number {
    return this.byDigest.size;
  }
}
