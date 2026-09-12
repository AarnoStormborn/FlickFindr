import path from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { logger } from "../logger.js";
import { config } from "../config.js";

/** The SDK does not re-export the pi-ai `Model` type, so derive it. */
type AvailableModel = Awaited<ReturnType<ModelRuntime["getAvailable"]>>[number];

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * models.json shipped with the backend (the Command Code provider). Resolved
 * from the module location, which is the same depth for src/ and dist/, so a
 * container picks it up regardless of HOME.
 */
const DEFAULT_MODELS_PATH = path.resolve(here, "../../pi-agent/models.json");

/**
 * Provider API keys read from the environment and registered with the runtime.
 *
 * Why not just `apiKey` in models.json? That field is honoured for requests,
 * but it does not mark the provider as *authenticated*, so `getAvailable()`
 * stays empty and model resolution finds nothing. Registering the credential
 * explicitly is what makes the catalog usable headlessly.
 */
const PROVIDER_KEYS: Record<string, string | undefined> = {
  commandcode: process.env.COMMAND_CODE_API_KEY,
};

/**
 * Minimal in-memory credential store.
 *
 * The default store persists to `~/.pi/agent/auth.json`, which would write the
 * API key to disk for no benefit — the key already arrives via the
 * environment. Keeping credentials in memory means a container has no secret
 * file to leak or clean up.
 */
function inMemoryCredentials() {
  const entries = new Map<string, { type: "api_key"; key?: string }>();
  return {
    async read(providerId: string) {
      return entries.get(providerId);
    },
    async list() {
      return [...entries].map(([providerId, c]) => ({ providerId, type: c.type }));
    },
    async modify(providerId: string, fn: (current: unknown) => Promise<unknown>) {
      const next = (await fn(entries.get(providerId))) as { type: "api_key"; key?: string } | undefined;
      if (next !== undefined) entries.set(providerId, next);
      return next ?? entries.get(providerId);
    },
    async delete(providerId: string) {
      entries.delete(providerId);
    },
  };
}

let _runtime: ModelRuntime | undefined;

/**
 * Lazily-created Pi ModelRuntime, shared by every agent feature.
 *
 * `modelsPath` is passed explicitly rather than relying on the ambient agent
 * directory so the bundled provider config always loads.
 */
export async function getModelRuntime(): Promise<ModelRuntime> {
  if (_runtime) return _runtime;
  _runtime = await ModelRuntime.create({
    modelsPath: config.agent.modelsPath ?? DEFAULT_MODELS_PATH,
    credentials: inMemoryCredentials() as never,
  });
  for (const [providerId, key] of Object.entries(PROVIDER_KEYS)) {
    if (key) await _runtime.setRuntimeApiKey(providerId, key);
  }
  return _runtime;
}

/** `provider/id`, lowercased — the canonical way to name a model here. */
function keyOf(model: AvailableModel): string {
  return `${model.provider}/${model.id}`.toLowerCase();
}

/** Cheapest first, then alphabetical, so the choice is deterministic. */

/**
 * Pure model choice: first entry in `wanted` that matches (exact `provider/id`
 * before substring), else the cheapest available model.
 *
 * Exported for tests — the surrounding resolution only adds runtime plumbing.
 */
export function chooseModel<T extends { provider: string; id: string; cost?: { input?: unknown; output?: unknown } }>(
  available: readonly T[],
  wanted: readonly string[],
): T | undefined {
  if (available.length === 0) return undefined;
  const key = (m: T) => `${m.provider}/${m.id}`.toLowerCase();
  for (const want of wanted) {
    const needle = want.trim().toLowerCase();
    if (!needle) continue;
    const match =
      available.find((m) => key(m) === needle) ?? available.find((m) => key(m).includes(needle));
    if (match) return match;
  }
  return [...available].sort((a, b) => {
    const cost = (m: T) => Number(m.cost?.input ?? 0) + Number(m.cost?.output ?? 0);
    return cost(a) - cost(b) || key(a).localeCompare(key(b));
  })[0];
}

/**
 * Resolve the model the agent should use. Explicit and ordered:
 *
 *   1. `PI_MODEL` (exact `provider/id`, else a substring match)
 *   2. `AGENT_MODEL_FALLBACKS`, else the built-in preference list in config
 *   3. only if nothing matches, the *cheapest* authenticated model
 *
 * Step 3 deliberately picks the cheapest rather than the first: provider
 * catalogs mix free models with $50/M flagships, so "first available" can be a
 * very expensive default to land on silently.
 */
export async function resolveAgentModel(): Promise<AvailableModel | undefined> {
  try {
    const runtime = await getModelRuntime();
    const available = [...(await runtime.getAvailable())];
    if (available.length === 0) {
      logger.warn("No authenticated models available; agent features will fall back");
      return undefined;
    }

    const wanted = [config.agent.model, ...config.agent.modelFallbacks].filter(
      (m): m is string => typeof m === "string" && m.trim().length > 0,
    );

    const chosen = chooseModel(available, wanted);
    if (chosen && wanted.some((w) => keyOf(chosen).includes(w.trim().toLowerCase()))) {
      logger.info({ model: keyOf(chosen) }, "Agent model resolved");
    } else if (chosen) {
      logger.warn(
        { model: keyOf(chosen), candidates: wanted },
        "No configured model matched; using the cheapest authenticated model",
      );
    }
    return chosen;
  } catch (err) {
    logger.error({ err }, "Failed to resolve agent model");
    return undefined;
  }
}

/** Agent features are usable when at least one model is authenticated. */
export async function isAgentConfigured(): Promise<boolean> {
  return (await resolveAgentModel()) !== undefined;
}
