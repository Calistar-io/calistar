/**
 * Fixed latency buckets, in milliseconds: the default boundaries OpenTelemetry uses for HTTP
 * request duration (5 ms to 10 s). A stored histogram has one count per bound, plus one overflow
 * bucket for everything above the last bound.
 */
export const BUCKET_BOUNDS_MS: readonly number[] = [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

export const BUCKET_COUNT = BUCKET_BOUNDS_MS.length + 1;

export const emptyBuckets = (): number[] => new Array<number>(BUCKET_COUNT).fill(0);

/**
 * Maps a histogram with any explicit bounds onto the fixed buckets, by upper bound: a source
 * bucket's count goes to the first fixed bucket whose bound is not below the source bucket's
 * upper bound. A source bucket without an upper bound (the last one) goes to the overflow bucket.
 *
 * @param boundsMs explicit bounds of the source histogram, in milliseconds
 * @param counts one count per source bucket: `boundsMs.length + 1` values
 */
export function mapBuckets(boundsMs: readonly number[], counts: readonly number[]): number[] {
  if (counts.length !== boundsMs.length + 1) {
    throw new Error(`histogram has ${counts.length} bucket counts for ${boundsMs.length} bounds`);
  }
  const out = emptyBuckets();
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i]!;
    if (count === 0) continue;
    const upper = boundsMs[i];
    let target = BUCKET_COUNT - 1;
    if (upper !== undefined) {
      const found = BUCKET_BOUNDS_MS.findIndex((bound) => bound >= upper);
      if (found !== -1) target = found;
    }
    out[target]! += count;
  }
  return out;
}

export function addBuckets(into: number[], from: readonly number[]): void {
  for (let i = 0; i < BUCKET_COUNT; i++) into[i]! += from[i] ?? 0;
}
