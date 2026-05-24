import {
  LangfuseSpanProcessor,
  type LangfuseSpanProcessorParams,
} from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  TraceIdRatioBasedSampler,
  type SpanProcessor,
  type TracerConfig,
} from "@opentelemetry/sdk-trace-base";
import type { Config } from "../config/index.ts";

export interface TracingHandle {
  readonly enabled: boolean;
  readonly shutdown: () => Promise<void>;
}

interface TracingProvider {
  readonly register: () => void;
  readonly shutdown: () => Promise<void>;
}

export interface TracingDependencies {
  readonly createSpanProcessor?: (
    params: LangfuseSpanProcessorParams,
  ) => SpanProcessor;
  readonly createProvider?: (config: TracerConfig) => TracingProvider;
}

const disabledTracing: TracingHandle = {
  enabled: false,
  shutdown: async () => {},
};

const maskSensitiveData = ({ data }: { data: unknown }): unknown => {
  if (typeof data !== "string") return data;

  return data
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(/\b(?:sk|pk)-lf-[A-Za-z0-9_-]+\b/g, "[REDACTED_LANGFUSE_KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_API_KEY]");
};

export const startLangfuseTracing = (
  config: Config,
  dependencies: TracingDependencies = {},
): TracingHandle => {
  if (!config.langfuse.enabled) {
    return disabledTracing;
  }

  try {
    const createSpanProcessor =
      dependencies.createSpanProcessor ??
      ((params: LangfuseSpanProcessorParams) =>
        new LangfuseSpanProcessor(params));
    const createProvider =
      dependencies.createProvider ??
      ((providerConfig: TracerConfig) => new NodeTracerProvider(providerConfig));

    const provider = createProvider({
      sampler: new TraceIdRatioBasedSampler(config.langfuse.sampleRate),
      spanProcessors: [
        createSpanProcessor({
          publicKey: config.langfuse.publicKey,
          secretKey: config.langfuse.secretKey,
          baseUrl: config.langfuse.baseUrl,
          mask: maskSensitiveData,
        }),
      ],
    });
    provider.register();

    return {
      enabled: true,
      shutdown: async () => {
        try {
          await provider.shutdown();
        } catch {
          // Tracing is optional; shutdown export failures must not break CLI exit.
        }
      },
    };
  } catch {
    return disabledTracing;
  }
};
