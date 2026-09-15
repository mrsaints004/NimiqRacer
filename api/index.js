import { initDb } from "../server/src/db.js";
import { createApp } from "../server/src/app.js";

let app;
let initPromise;

export default async function handler(req, res) {
  if (!app) {
    // Deduplicate concurrent cold-start init calls; reset on failure so the next
    // request retries instead of caching a rejected promise permanently.
    if (!initPromise) {
      initPromise = initDb()
        .then(() => { app = createApp(); })
        .catch((err) => { initPromise = null; throw err; });
    }
    await initPromise;
  }
  return app(req, res);
}
