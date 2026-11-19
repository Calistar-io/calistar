/**
 * Path normalization for API routes.
 *
 * A request path can carry an account, a contract, a transaction hash, a user ID or a secret.
 * Each path segment is matched against an ordered list of rules and replaced by a placeholder,
 * so what is stored is the shape of the route and never the identifier.
 *
 * Stellar keys are matched by shape, not by checksum, and without regard to case or to what
 * surrounds them: a mistyped, lower-cased or embedded secret seed must be redacted too. A rule
 * always replaces the whole segment, so the only way to leak is for no rule to match.
 */

/** Stellar strkeys are base32 (RFC 4648 alphabet), without padding. Segments are upper-cased first. */
const B32 = "[A-Z2-7]";

/** A secret seed anywhere in the segment: no boundary is required around it. */
const SECRET_SEED = new RegExp(`S${B32}{55}`);
const MUXED_ACCOUNT = new RegExp(`^M${B32}{68}$`);
const ACCOUNT = new RegExp(`^G${B32}{55}$`);
const CONTRACT = new RegExp(`^C${B32}{55}$`);
// Claimable balance (B), liquidity pool (L), signed payload (P), pre-authorized transaction (T),
// muxed contract (W), hash-x (X). Lengths run from 56 to 165 characters: a signed payload's
// length depends on its payload.
const OTHER_STRKEY = new RegExp(`^[BLPTWX]${B32}{55,164}$`);
const ASSET = new RegExp(`^[A-Z0-9]{1,12}[-:]G${B32}{55}$`);
/** Any run long enough to hold a key: a key glued to other text, or a key type not known yet. */
const EMBEDDED_KEY = new RegExp(`${B32}{56,}`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_64 = /^[0-9a-f]{64}$/i;
const HEX_PREFIXED = /^0x[0-9a-f]+$/i;
const HEX_LONG = /^(?=.*[a-f])[0-9a-f]{16,}$/i;
const INTEGER = /^\d+$/;
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*)?$/;
// Opaque base64url value: long, with lower case, upper case and digits. A lower-case slug is left alone.
const OPAQUE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_-]{32,}={0,2}$/;

export const LONG_SEGMENT = 64;

/** A whole segment shaped like a public Stellar key or an asset: it gets its own placeholder. */
const isPublicKeyShape = (upper: string): boolean =>
  MUXED_ACCOUNT.test(upper) || ACCOUNT.test(upper) || CONTRACT.test(upper) || OTHER_STRKEY.test(upper) || ASSET.test(upper);

export interface Rule {
  /** Position in the ordered list: the first rule that matches wins. */
  readonly order: number;
  readonly name: string;
  readonly placeholder: string;
  /** `segment` is percent-decoded; `upper` is the same text in upper case, for the Stellar rules. */
  matches(segment: string, upper: string): boolean;
}

const rule = (name: string, placeholder: string, matches: Rule["matches"]): Omit<Rule, "order"> => ({
  name,
  placeholder,
  matches,
});

/** The ordered rule set. */
export const RULES: readonly Rule[] = [
  // First, so that a seed is redacted whatever else the segment looks like. A segment that is
  // exactly a public key is left to its own rule: it is replaced whole, and cannot hold a seed
  // that would survive.
  rule("Stellar secret seed", ":redacted", (_s, u) => SECRET_SEED.test(u) && !isPublicKeyShape(u)),
  rule("Muxed account", ":muxed", (_s, u) => MUXED_ACCOUNT.test(u)),
  rule("Account", ":account", (_s, u) => ACCOUNT.test(u)),
  rule("Contract", ":contract", (_s, u) => CONTRACT.test(u)),
  rule("Other Stellar key", ":strkey", (_s, u) => OTHER_STRKEY.test(u)),
  rule("Asset (code and issuer)", ":asset", (_s, u) => ASSET.test(u)),
  rule("Embedded or unknown Stellar key", ":strkey", (_s, u) => EMBEDDED_KEY.test(u)),
  rule("UUID", ":uuid", (s) => UUID.test(s)),
  rule("64-character hex", ":hash", (s) => HEX_64.test(s)),
  rule("Other hex value", ":hex", (s) => HEX_PREFIXED.test(s) || HEX_LONG.test(s)),
  rule("Integer", ":id", (s) => INTEGER.test(s)),
  rule("Opaque token", ":token", (s) => JWT.test(s) || OPAQUE.test(s)),
  rule("Long segment", ":long", (s) => s.length > LONG_SEGMENT),
].map((r, i) => ({ ...r, order: i + 1 }));

/** How many times a segment is decoded: `%2553` hides an `S` behind two rounds of encoding. */
const MAX_DECODE_ROUNDS = 3;

/**
 * Percent-decoding that never gives up on the whole segment. `decodeURIComponent` throws on one
 * malformed escape, which would leave every other escape encoded and hide a key from the rules.
 */
function decodeOnce(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // Not valid UTF-8 as a whole: decode the ASCII escapes one by one, leave the rest.
      return run.replace(/%([0-7][0-9a-f])/gi, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    }
  });
}

function decode(segment: string): string {
  let text = segment;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round++) {
    const next = decodeOnce(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Normalizes one path segment: the placeholder of the first matching rule, or the segment unchanged. */
export function normalizeSegment(segment: string): string {
  const decoded = decode(segment);
  const upper = decoded.toUpperCase();
  for (const r of RULES) {
    if (r.matches(decoded, upper)) return r.placeholder;
  }
  return segment;
}

/**
 * Normalizes a request path or a route. The query string, the fragment and a trailing slash are
 * dropped first. A full URL is reduced to its path. A route already set by the caller
 * (`/accounts/:id`) goes through the same rules, so a raw address is never kept as a route.
 */
export function normalizePath(input: string): string {
  let path = input;
  const scheme = path.indexOf("://");
  if (scheme !== -1) {
    const afterHost = path.indexOf("/", scheme + 3);
    path = afterHost === -1 ? "/" : path.slice(afterHost);
  }
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);

  const segments = path.split("/").filter((s) => s !== "");
  return "/" + segments.map(normalizeSegment).join("/");
}
