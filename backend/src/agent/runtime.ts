import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { logger } from "../logger.js";
import { config } from "../config.js";

let _runtime: ModelRuntime | undefined;

/** Lazily-created Pi ModelRuntime. Uses ~/.pi/agent credentials by default. */
export async function getModelRuntime(): Promise<ModelRuntime> {
  if (!_runtime) {
    _runtime = await ModelRuntime.create();
  }
  return _runtime;
}

/**
 * Pick the model for agent work: explicit PI_MODEL override first, else the
 * first currently-authenticated model from the runtime.
 */
export async function getAgentModel(): Promise<{ id: string } | undefined> {
  try {
    const runtime = await getModelRuntime();
    const available = await runtime.getAvailable();
    if (config.agent.model) {
      const wanted = config.agent.model.toLowerCase();
      const match = available.find((m) => String(m.id ?? m.name ?? "").toLowerCase().includes(wanted));
      if (match) return { id: String(match.id ?? match.name) };
    }
    const first = available[0];
    if (first) return { id: String(first.id ?? first.name ?? "available-model") };
    logger.warn("No authenticated models available for agent use");
    return undefined;
  } catch (err) {
    logger.error({ err }, "Failed to resolve agent model");
    return undefined;
  }
}