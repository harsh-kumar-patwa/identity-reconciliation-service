export const config = {
  port: Number(process.env.PORT) || 3000,
  version: process.env.APP_VERSION || "dev",
  gitSha: process.env.GIT_SHA || "unknown",
  buildTime: process.env.BUILD_TIME || "unknown",
  normalizeInput: process.env.FEATURE_NORMALIZE_INPUT === "true",
  chaosErrorRate: Number(process.env.CHAOS_ERROR_RATE) || 0,
};
