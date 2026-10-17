import { sdk } from "./tracing";
import app, { state } from "./app";
import prisma from "./db";
import logger from "./logger";
import { config } from "./config";

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, version: config.version, gitSha: config.gitSha }, "server started");
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  state.shuttingDown = true;

  // Stop taking new connections, let in-flight requests finish, then close the DB pool.
  server.close(async () => {
    await prisma.$disconnect();
    await sdk?.shutdown();
    logger.info("shutdown complete");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("in-flight requests did not finish in time, exiting");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
