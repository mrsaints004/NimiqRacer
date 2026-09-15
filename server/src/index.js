import { initDb, db } from "./db.js";
import { createApp } from "./app.js";

const PORT = process.env.PORT || 8787;

async function main() {
  await initDb();
  const app = createApp();

  const server = app.listen(PORT, () => {
    console.log(`Nimiq Racer analytics server listening on http://localhost:${PORT}`);
  });

  function shutdown(signal) {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
