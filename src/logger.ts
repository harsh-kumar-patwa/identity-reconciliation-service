import pino from "pino";
import { trace } from "@opentelemetry/api";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const { traceId, spanId } = span.spanContext();
    return { trace_id: traceId, span_id: spanId };
  },
});

export default logger;
