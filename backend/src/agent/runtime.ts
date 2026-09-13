import path from "node:path";
import fs from "node:fs/promises";
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
 * Dedicated agent directory for the backend.
 *
 * Why not the SDK default (~/.pi/agent)? That directory belongs to whoever runs
 * the process, and the resource loader reads extensions, settings.json
 * (defaultProvider, enabledModels), mcp.json and skills from it. Inheriting it
 * means the API's agent behaviour — and even which MCP servers it connects to —
 * depends on the deploying machine, so it is not reproducible. A clean
directory gives deterministic behaviour and no third-party extensions.
 */
export const AGENT_DIR = process.env.PI_AGENT_DIR ?? path.resolve(here, "../../pi-agent/agent");

/** Model catalog cache location, kept out of the host's agent dir too. */
const MODELS_STORE_PATH = path.join(AGENT_DIR, "models-store.json");

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
  // The agent dir must exist before the SDK writes its catalog cache into it.
  await fs.mkdir(AGENT_DIR, { recursive: true });
  _runtime = await ModelRuntime.create({
    modelsPath: config.agent.modelsPath ?? DEFAULT_MODELS_PATH,
    modelsStorePath: MODELS_STORE_PATH,
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
 * Match a preference string against available models, in order.
 *
 * Preference strings are `provider/id`, and the match is **provider-scoped**:
 * substring matching across the whole list is wrong, because e.g.
 * "deepseek/deepseek-v4-flash" (the direct provider) is a substring of
 * "commandcode/deepseek/deepseek-v4-flash" (the aggregator), so an unqualified
 * search silently selects a different provider's model.
 *
 * Within the named provider, an exact id wins over a substring, so "qwen/3.8"
 * cannot beat an exact "qwen/qwen3.8-27b" entry.
 */
export function matchCandidates<
  T extends { provider: string; id: string; cost?: { input?: unknown; output?: unknown } },
>(available: readonly T[], wanted: readonly string[]): T[] {
  const key = (m: T) => `${m.provider}/${m.id}`.toLowerCase();
  const out: T[] = [];
  const seen = new Set<string>();

  for (const want of wanted) {
    const needle = want.trim().toLowerCase();
    if (!needle) continue;
    const slash = needle.indexOf("/");
    let match: T | undefined;
    if (slash > 0) {
      const provider = needle.slice(0, slash);
      const rest = needle.slice(slash + 1);
      const pool = available.filter((m) => String(m.provider).toLowerCase() === provider);
      match = pool.find((m) => String(m.id).toLowerCase() === rest) ?? pool.find((m) => String(m.id).toLowerCase().includes(rest));
    } else {
      match = available.find((m) => key(m) === needle) ?? available.find((m) => key(m).includes(needle));
    }
    if (match && !seen.has(key(match))) {
      seen.add(key(match));
      out.push(match);
    }
  }
  return out;
}

/**
 * Pure model choice: the first preference that matches, else the cheapest
 * available model. Exported for tests — the surrounding code adds plumbing.
 */
export function chooseModel<
  T extends { provider: string; id: string; cost?: { input?: unknown; output?: unknown } },
>(available: readonly T[], wanted: readonly string[]): T | undefined {
  if (available.length === 0) return undefined;
  const matched = matchCandidates(available, wanted);
  if (matched.length) return matched[0];
  const key = (m: T) => `${m.provider}/${m.id}`.toLowerCase();
  const cost = (m: T) => Number(m.cost?.input ?? 0) + Number(m.cost?.output ?? 0);
  return [...available].sort((a, b) => cost(a) - cost(b) || key(a).localeCompare(key(b)))[0];
}

/**
 * Ordered list of usable models: the configured preference order, filtered to
 * those actually available, plus any other authenticated model as a last
 * resort. Lets a caller retry with the next model when one is rate-limited or
 * out of free quota.
 */
/** Cheapest first, then alphabetical — deterministic ordering. */
function byCost() {
  const cost = (m: AvailableModel) => Number(m.cost?.input ?? 0) + Number(m.cost?.output ?? 0);
  return (a: AvailableModel, b: AvailableModel) => cost(a) - cost(b) || keyOf(a).localeCompare(keyOf(b));
}

export async function resolveAgentModelCandidates(): Promise<AvailableModel[]> {
  try {
    const runtime = await getModelRuntime();
    const available = await runtime.getAvailable();
    if (available.length === 0) return [];

    const wanted = [config.agent.model, ...config.agent.modelFallbacks].filter(
      (m): m is string => typeof m === "string" && m.trim().length > 0,
    );

    // Preferred models first, then everything else cheapest-first, so a retry
    // always has somewhere to go.
    const ordered = matchCandidates(available, wanted);
    const seen = new Set(ordered.map(keyOf));
    for (const m of [...available].sort(byCost())) {
      if (!seen.has(keyOf(m))) ordered.push(m);
    }
    return ordered;
  } catch (err) {
    logger.error({ err }, "Failed to resolve agent model candidates");
    return [];
  }
}

/** The single preferred model (first usable candidate). */
export async function resolveAgentModel(): Promise<AvailableModel | undefined> {
  return (await resolveAgentModelCandidates())[0];
}

/** Agent features are usable when at least one model is authenticated. */
export async function isAgentConfigured(): Promise<boolean> {
  return (await resolveAgentModel()) !== undefined;
}
