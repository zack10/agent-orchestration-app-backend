import { RequestHandler } from "express";
import { config } from "../config";

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

export const rateLimit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = buckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + 60_000 }
      : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  res.setHeader("RateLimit-Limit", String(config.apiRateLimitPerMinute));
  res.setHeader(
    "RateLimit-Remaining",
    String(Math.max(0, config.apiRateLimitPerMinute - bucket.count)),
  );
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > config.apiRateLimitPerMinute) {
    res
      .status(429)
      .json({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
    return;
  }
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets)
      if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  next();
};
