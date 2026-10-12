import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import contactRoutes from "./routes/contact.routes";
import prisma from "./db";
import logger from "./logger";
import { config } from "./config";
import { registry, httpRequests, httpDuration } from "./metrics";

export const state = { shuttingDown: false };

const app = express();

app.use(helmet());
app.use(express.json({ limit: "10kb" }));
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => ["/livez", "/readyz", "/metrics"].includes(req.url ?? "") },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on("finish", () => {
    // Use the matched route pattern, not the raw URL, so label values stay bounded.
    const route = req.route ? req.baseUrl + req.route.path : "unmatched";
    httpRequests.inc({ method: req.method, route, status: res.statusCode });
    end({ method: req.method, route });
  });
  next();
});

app.get("/livez", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/readyz", async (_req, res) => {
  if (state.shuttingDown) {
    res.status(503).json({ status: "shutting down" });
    return;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "database unreachable" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/version", (_req, res) => {
  res.json({ version: config.version, gitSha: config.gitSha, buildTime: config.buildTime });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

app.use("/", contactRoutes);

export default app;
