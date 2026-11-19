import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { normalizePath, normalizeSegment, RULES } from "../src/index.ts";
import { buildCorpus, ENCODERS, type CorpusCase } from "./corpus/generate.ts";
import golden from "./corpus/golden.json" with { type: "json" };

describe("Stellar corpus", () => {
  it("covers every key type the SDK can encode", () => {
    const sdkEncoders = Object.getOwnPropertyNames(StrKey).filter((name) => name.startsWith("encode"));
    expect(Object.keys(ENCODERS).sort()).toEqual(sdkEncoders.sort());
  });

  it("is the corpus the generator builds from the installed SDK", () => {
    expect(golden.cases).toEqual(buildCorpus());
  });

  it.each(golden.cases as CorpusCase[])("$kind: $input", ({ input, expected }) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it("never lets a generated secret seed through", () => {
    const seeds = ENCODERS.encodeEd25519SecretSeed!.keys(50);
    for (const seed of seeds) {
      for (const input of [`/${seed}`, `/a/${seed}/b`, `/a/x-${seed}`, `/a/${seed}.json`, `/a?secret=${seed}`]) {
        expect(normalizePath(input)).not.toContain(seed);
      }
    }
  });
});

describe("other identifiers", () => {
  it.each([
    ["/users/3f2b9c1e-8a7d-4c5b-9e6f-0a1b2c3d4e5f", "/users/:uuid"],
    ["/users/3F2B9C1E-8A7D-4C5B-9E6F-0A1B2C3D4E5F", "/users/:uuid"],
    ["/tx/7a3f9c2e1b4d6f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708", "/tx/:hash"],
    ["/blocks/0x1f", "/blocks/:hex"],
    ["/objects/9f86d081884c7d65", "/objects/:hex"],
    ["/ledgers/58123456", "/ledgers/:id"],
    ["/ledgers/58123456/transactions", "/ledgers/:id/transactions"],
    ["/orders/1234567890123456789012", "/orders/:id"],
    ["/session/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk", "/session/:token"],
    ["/invite/Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A", "/invite/:token"],
    [`/files/${"z".repeat(65)}`, "/files/:long"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe("paths left alone", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/health", "/health"],
    ["/v1/accounts", "/v1/accounts"],
    ["/v2/pools/", "/v2/pools"],
    ["/docs/getting-started-with-stellar-smart-contracts", "/docs/getting-started-with-stellar-smart-contracts"],
    ["/assets/native", "/assets/native"],
    ["/colors/cafe", "/colors/cafe"],
    ["/blog/deadbeef", "/blog/deadbeef"],
    ["/search?q=GABC", "/search"],
    ["/a//b/#top", "/a/b"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe("routes and URLs", () => {
  const account = ENCODERS.encodeEd25519PublicKey!.keys(1)[0]!;

  it("keeps a route template set by the caller", () => {
    expect(normalizePath("/accounts/:account_id/payments")).toBe("/accounts/:account_id/payments");
    expect(normalizePath("/accounts/{account_id}")).toBe("/accounts/{account_id}");
  });

  it("still normalizes a route that carries a raw address", () => {
    expect(normalizePath(`/accounts/${account}/payments`)).toBe("/accounts/:account/payments");
  });

  it("reduces a full URL to its path", () => {
    expect(normalizePath(`https://api.example.org/accounts/${account}?limit=10`)).toBe("/accounts/:account");
    expect(normalizePath("https://api.example.org")).toBe("/");
  });

  it("applies the first matching rule only", () => {
    expect(RULES.map((r) => r.order)).toEqual([...RULES.keys()].map((i) => i + 1));
    expect(normalizeSegment("1234")).toBe(":id");
  });
});
