/**
 * Pi SDK integration — the agent is the main runner for natural-language
 * search queries and chat.
 *
 * - `runtime.ts` owns the ModelRuntime singleton (auth via ~/.pi/agent).
 * - `queryParser.ts` turns a natural-language query into a structured
 *   HybridSearchRequest (filters + semantic intent).
 * - `chat.ts` runs a catalog assistant session with tool access to the
 *   search services, streaming text deltas.
 */