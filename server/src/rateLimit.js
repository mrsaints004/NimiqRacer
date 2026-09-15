// In-memory sliding-window rate limiter. Fine for a single Node instance;
// swap for a Redis-backed limiter if the API is ever scaled to multiple instances.
const buckets = new Map();

export function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      buckets.set(key, timestamps);
    }
    while (timestamps.length && timestamps[0] < windowStart) timestamps.shift();

    if (timestamps.length >= max) {
      return res.status(429).json({ error: "too_many_requests" });
    }

    timestamps.push(now);
    next();
  };
}

// Periodically drop buckets that have gone idle so memory doesn't grow unbounded.
// Skip on Vercel — serverless functions are short-lived, so setInterval is pointless
// and can prevent the process from exiting cleanly.
if (!process.env.VERCEL) {
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [key, timestamps] of buckets) {
      if (!timestamps.length || timestamps[timestamps.length - 1] < cutoff) buckets.delete(key);
    }
  }, 5 * 60 * 1000).unref();
}
