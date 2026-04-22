import path from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { backfillEmployeeTimezones } from "./lib/timezone-backfill";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// In production (e.g. self-hosted VPS) the same Node process serves the
// built React SPA so that one nginx vhost / one PM2 process is enough.
// On Replit, each artifact has its own dev server so this branch is skipped.
if (process.env.NODE_ENV === "production") {
  const candidates = [
    path.resolve(process.cwd(), "artifacts/mysticshr/dist/public"),
    path.resolve(process.cwd(), "../mysticshr/dist/public"),
    path.resolve(process.cwd(), "../../mysticshr/dist/public"),
  ];
  const spaDir = candidates.find((p) => existsSync(path.join(p, "index.html")));

  if (spaDir) {
    logger.info({ spaDir }, "Serving SPA in production");
    app.use(express.static(spaDir, { maxAge: "1h", index: false }));
    // Catch-all: send index.html for any non-/api request so client-side
    // routing (React Router) handles the rest.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(spaDir, "index.html"));
    });
  } else {
    logger.warn(
      { tried: candidates },
      "NODE_ENV=production but built SPA not found; only /api will be served",
    );
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler(port);
  void backfillEmployeeTimezones();
});
