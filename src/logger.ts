import pino from "pino";

// trace_id and span_id are added to each log line by the OpenTelemetry pino instrumentation.
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export default logger;
