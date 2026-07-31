import { agentOS, setup } from "@rivet-dev/agentos";
import pi from "@agentos-software/pi";

interface ConnectionParams {
  token?: string;
}

const authToken = process.env.AGENTOS_AUTH_TOKEN;
const allowUnauthenticatedLocal =
  process.env.AGENTOS_ALLOW_UNAUTHENTICATED_LOCAL === "1";

function isLoopbackHost(host: string) {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){0,3}$/.test(normalized);
}

function isLoopbackEndpoint(endpoint: string) {
  try {
    return isLoopbackHost(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

if (!authToken && !allowUnauthenticatedLocal) {
  throw new Error(
    "Set AGENTOS_AUTH_TOKEN, or explicitly set AGENTOS_ALLOW_UNAUTHENTICATED_LOCAL=1 for loopback-only development",
  );
}

if (allowUnauthenticatedLocal) {
  const engineHost = process.env.RIVET_RUN_ENGINE_HOST;
  const endpoint = process.env.RIVET_ENGINE ?? process.env.RIVET_ENDPOINT;
  if ((engineHost && !isLoopbackHost(engineHost)) || (endpoint && !isLoopbackEndpoint(endpoint))) {
    throw new Error(
      "Unauthenticated local mode cannot use a non-loopback Rivet engine host or endpoint",
    );
  }
}

const vm = agentOS<undefined, ConnectionParams>({
  software: [pi],
  onBeforeConnect: (_context, params) => {
    const token =
      params && typeof params === "object" && "token" in params
        ? params.token
        : undefined;
    if (authToken && token !== authToken) {
      throw new Error("Invalid agentOS connection capability");
    }
  },
});

export const registry = setup({
  use: { vm },
  ...(allowUnauthenticatedLocal
    ? { engineHost: "127.0.0.1", httpHost: "127.0.0.1" }
    : {}),
});

if (allowUnauthenticatedLocal && process.env.RIVETKIT_RUNTIME_MODE === "serverless") {
  registry.listen({ host: "127.0.0.1" }).catch((error) => {
    console.error("agentOS failed to start its loopback listener", error);
    process.exit(1);
  });
} else {
  registry.start();
}
