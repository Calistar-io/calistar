/**
 * Client address handling for web events. The full address exists in memory only, for the time
 * it takes to truncate it: IPv4 to /24, IPv6 to /48. Umami receives the truncated address and
 * derives the country and the visitor hash from it.
 */
import { isIPv4, isIPv6 } from "node:net";

/** Expands an IPv6 address to its eight 16-bit groups, or `undefined` when it is not one. */
function ipv6Groups(address: string): number[] | undefined {
  if (!isIPv6(address)) return undefined;
  let text = address;
  // An embedded IPv4 tail (::ffff:192.0.2.1) is two groups.
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = text.slice(0, tail.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  if (fill < 0) return undefined;
  const groups = [...left, ...new Array<string>(fill).fill("0"), ...right].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : undefined;
}

/**
 * Truncates an address: IPv4 to /24 (last octet zeroed), IPv6 to /48 (last 80 bits zeroed).
 * An IPv4 address carried inside IPv6 (`::ffff:a.b.c.d`) is treated as IPv4.
 * Returns `undefined` for anything that is not an IP address: nothing is forwarded then.
 */
export function truncateIp(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const text = address.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");

  if (isIPv4(text)) {
    const octets = text.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  const groups = ipv6Groups(text);
  if (!groups) return undefined;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    return `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.0`;
  }
  return `${groups
    .slice(0, 3)
    .map((g) => g.toString(16))
    .join(":")}::`;
}

/**
 * The client address of a request.
 *
 * @param socketAddress address of the TCP peer
 * @param forwardedFor value of `X-Forwarded-For`, if any
 * @param trustedHops number of proxies in front of the gateway that append to `X-Forwarded-For`.
 *   With 0 the header is ignored and the TCP peer is the client. With n, the client is the nth
 *   entry from the right: entries further left can be set by the caller and are never trusted.
 */
export function clientIp(socketAddress: string | undefined, forwardedFor: string | undefined, trustedHops: number): string | undefined {
  if (trustedHops <= 0) return socketAddress;
  const chain = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return chain.at(-trustedHops) ?? socketAddress;
}
