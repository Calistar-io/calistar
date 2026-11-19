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
      const lower = seed.toLowerCase();
      const inputs = [
        `/${seed}`, `/a/${seed}/b`, `/a/x-${seed}`, `/a/${seed}.json`, `/a?secret=${seed}`,
        `/a/KEY${seed}`, `/a/${seed}KEY`, `/a/G${seed}`, `/a/${seed}${seed}`,
        `/a/${lower}`, `/a/key${lower}`, `/a/%53${seed.slice(1)}`, `/a/%2553${seed.slice(1)}`,
      ];
      for (const input of inputs) {
        const out = normalizePath(input);
        // The first letter is known to be S: the 55 characters after it are the secret.
        expect(out.toUpperCase()).not.toContain(seed.slice(1));
      }
    }
  });
});

describe("nested percent-encoding", () => {
  const seed = ENCODERS.encodeEd25519SecretSeed!.keys(1)[0]!;
  /** Encodes the leading "S" `rounds` times: %53, %2553, %252553, ... */
  const hidden = (rounds: number) => `%${"25".repeat(rounds - 1)}53${seed.slice(1)}`;

  it.each([1, 2, 3, 4, 8, 15, 16, 17, 40])("redacts a seed encoded %i times", (rounds) => {
    const out = normalizePath(`/sign/${hidden(rounds)}`);
    expect(out).toBe("/sign/:redacted");
  });

  it("redacts a segment that is still encoded after the last round, whatever it holds", () => {
    expect(normalizePath(`/a/%${"25".repeat(30)}41`)).toBe("/a/:redacted");
  });

  it("leaves an ordinary encoded segment alone", () => {
    expect(normalizePath("/files/annual%20report")).toBe("/files/annual%20report");
    expect(normalizePath("/files/100%25")).toBe("/files/100%25");
    expect(normalizePath("/files/50%")).toBe("/files/50%");
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
    [`/files/${"a-".repeat(33)}`, "/files/:long"],
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
