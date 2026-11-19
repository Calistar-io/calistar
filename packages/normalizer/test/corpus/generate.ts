/**
 * Builds test/corpus/golden.json: one group of cases per Stellar key type, with keys produced by
 * the key utilities of the Stellar SDK. Keys are derived from fixed seeds, so the file is
 * reproducible: `pnpm --filter @calistar/normalizer corpus`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { StrKey } from "@stellar/stellar-sdk";

export interface CorpusCase {
  kind: string;
  input: string;
  expected: string;
}

/** Deterministic bytes: the SDK encoders take raw key material. */
function bytes(length: number, seed: string): Buffer {
  let out = Buffer.alloc(0);
  for (let i = 0; out.length < length; i++) {
    out = Buffer.concat([out, createHash("sha256").update(`${seed}:${i}`).digest()]);
  }
  return out.subarray(0, length);
}

/** A signed payload is a 32-byte key, a 4-byte length, then the payload padded to 4 bytes. */
function signedPayload(payloadLength: number, seed: string): Buffer {
  const padded = Math.ceil(payloadLength / 4) * 4;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payloadLength);
  return Buffer.concat([bytes(32, seed), length, bytes(payloadLength, `${seed}:payload`), Buffer.alloc(padded - payloadLength)]);
}

/**
 * Every `encode*` function of the SDK's StrKey, with the placeholder its keys must become.
 * test/corpus.test.ts fails when the SDK gains an encoder that is missing here.
 */
export const ENCODERS: Record<string, { placeholder: string; keys: (n: number) => string[] }> = {
  encodeEd25519SecretSeed: { placeholder: ":redacted", keys: (n) => many(n, (s) => StrKey.encodeEd25519SecretSeed(bytes(32, s))) },
  encodeMed25519PublicKey: { placeholder: ":muxed", keys: (n) => many(n, (s) => StrKey.encodeMed25519PublicKey(bytes(40, s))) },
  encodeEd25519PublicKey: { placeholder: ":account", keys: (n) => many(n, (s) => StrKey.encodeEd25519PublicKey(bytes(32, s))) },
  encodeContract: { placeholder: ":contract", keys: (n) => many(n, (s) => StrKey.encodeContract(bytes(32, s))) },
  encodeLiquidityPool: { placeholder: ":strkey", keys: (n) => many(n, (s) => StrKey.encodeLiquidityPool(bytes(32, s))) },
  encodeClaimableBalance: { placeholder: ":strkey", keys: (n) => many(n, (s) => StrKey.encodeClaimableBalance(bytes(33, s))) },
  encodePreAuthTx: { placeholder: ":strkey", keys: (n) => many(n, (s) => StrKey.encodePreAuthTx(bytes(32, s))) },
  encodeSha256Hash: { placeholder: ":strkey", keys: (n) => many(n, (s) => StrKey.encodeSha256Hash(bytes(32, s))) },
  encodeMuxedContract: { placeholder: ":strkey", keys: (n) => many(n, (s) => StrKey.encodeMuxedContract(bytes(40, s))) },
  encodeSignedPayload: {
    placeholder: ":strkey",
    // Shortest, mid and longest payloads: the encoded length changes with the payload.
    keys: () => [1, 4, 29, 32, 64].map((len) => StrKey.encodeSignedPayload(signedPayload(len, `signed-payload-${len}`))),
  },
};

function many(n: number, encode: (seed: string) => string): string[] {
  return Array.from({ length: n }, (_, i) => encode(`corpus-${i}`));
}

export function buildCorpus(perType = 5): CorpusCase[] {
  const cases: CorpusCase[] = [];
  for (const [kind, { placeholder, keys }] of Object.entries(ENCODERS)) {
    for (const key of keys(perType)) {
      cases.push({ kind, input: `/v1/items/${key}`, expected: `/v1/items/${placeholder}` });
      cases.push({ kind, input: `/v1/items/${key}/payments/?cursor=now`, expected: `/v1/items/${placeholder}/payments` });
    }
  }

  // A secret seed is redacted wherever it sits in a segment.
  for (const seed of ENCODERS.encodeEd25519SecretSeed!.keys(perType)) {
    cases.push({ kind: "secret seed in a segment", input: `/sign/secret=${seed}`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed in a segment", input: `/sign/USDC:${seed}`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed in a segment", input: `/sign/key%3D${seed}`, expected: "/sign/:redacted" });
    // Glued to base32 characters on either side: no boundary to rely on.
    cases.push({ kind: "secret seed glued to text", input: `/sign/KEY${seed}`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed glued to text", input: `/sign/${seed}BACKUP`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed glued to text", input: `/sign/2${seed}7`, expected: "/sign/:redacted" });
    // Lower-cased or mixed case, as a client or a proxy may rewrite a path.
    cases.push({ kind: "secret seed, other case", input: `/sign/${seed.toLowerCase()}`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed, other case", input: `/sign/s${seed.slice(1, 20).toLowerCase()}${seed.slice(20)}`, expected: "/sign/:redacted" });
    // Percent-encoded once, twice, and next to an escape that is not valid UTF-8.
    cases.push({ kind: "secret seed, encoded", input: `/sign/%53${seed.slice(1)}`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed, encoded", input: `/sign/%2553${seed.slice(1)}`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed, encoded", input: `/sign/%FF%53${seed.slice(1)}`, expected: "/sign/:redacted" });
    cases.push({ kind: "secret seed, encoded", input: `/sign/%ZZ${seed}`, expected: "/sign/:redacted" });
  }

  // A public key in another case, glued to text, or of a type not known yet, is still replaced.
  for (const account of ENCODERS.encodeEd25519PublicKey!.keys(perType)) {
    cases.push({ kind: "account, other case", input: `/accounts/${account.toLowerCase()}`, expected: "/accounts/:account" });
    cases.push({ kind: "embedded key", input: `/accounts/acct_${account}`, expected: "/accounts/:strkey" });
    cases.push({ kind: "embedded key", input: `/accounts/${account}.json`, expected: "/accounts/:strkey" });
    cases.push({ kind: "unknown key type", input: `/keys/Z${account.slice(1)}`, expected: "/keys/:strkey" });
  }

  // An asset is a code and its issuer, joined by "-" or ":".
  for (const issuer of ENCODERS.encodeEd25519PublicKey!.keys(perType)) {
    for (const code of ["XLM", "USDC", "yXLM", "AQUAnetwork1"]) {
      cases.push({ kind: "asset", input: `/assets/${code}-${issuer}`, expected: "/assets/:asset" });
      cases.push({ kind: "asset", input: `/assets/${code}:${issuer}/trades`, expected: "/assets/:asset/trades" });
      cases.push({ kind: "asset", input: `/assets/${code}%3A${issuer}`, expected: "/assets/:asset" });
    }
  }
  return cases;
}

if (import.meta.main) {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const golden = { sdk: `@stellar/stellar-sdk ${pkg.devDependencies["@stellar/stellar-sdk"]}`, cases: buildCorpus() };
  writeFileSync(new URL("./golden.json", import.meta.url), `${JSON.stringify(golden, null, 1)}\n`);
  console.log(`golden.json: ${golden.cases.length} cases, ${golden.sdk}`);
}
