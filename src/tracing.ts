import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressLayerType } from "@opentelemetry/instrumentation-express";

// Must be imported before express and pg so the auto-instrumentation can patch them.
export const sdk = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  ? new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || "identity-service",
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-express": { ignoreLayersType: [ExpressLayerType.MIDDLEWARE] },
        }),
      ],
    })
  : null;

sdk?.start();
