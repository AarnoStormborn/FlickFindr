/**
 * Embedding service — transformers.js port of the old
 * sentence-transformers `all-MiniLM-L6-v2` pipeline (384-dim vectors).
 *
 * The model is loaded lazily on first use to keep API startup fast, and
 * cached as a module singleton.
 */

import { FeatureExtractionPipeline, pipeline } from "@huggingface/transformers";
import { logger } from "./logger.js";

export const EMBEDDING_DIM = 384;

/**
 * The embedding model, overridable so a swap can be A/B tested rather than
 * argued about:
 *
 *   EMBEDDING_MODEL=Xenova/bge-small-en-v1.5 npm run embeddings   # documents
 *   EMBEDDING_MODEL=Xenova/bge-small-en-v1.5 npm run eval:relevance
 *
 * The dimension must stay 384: `plot_embedding` and `keywords_embedding` are
 * `vector(384)`, so a 768-dim model means a schema change and a full re-embed of
 * both columns. 384-dim candidates worth trying are bge-small-en-v1.5 (the
 * strongest of them on retrieval benchmarks) and gte-small.
 */
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";

/**
 * Some models expect an instruction on the query side and nothing on the document
 * side (BGE), or a role prefix on both (E5). Empty by default, which is correct
 * for MiniLM.
 *
 * The two are asymmetric and the call sites already are: `generateEmbedding` is
 * the query path (routes pass it to the search services), while the embedding
 * scripts call `batchGenerateEmbeddings` for documents. Getting that the wrong way
 * round silently degrades every search, so the prefixes are applied by role.
 */
export const QUERY_PREFIX = process.env.EMBEDDING_QUERY_PREFIX ?? "";
export const PASSAGE_PREFIX = process.env.EMBEDDING_PASSAGE_PREFIX ?? "";

/** Prefix a search query. Exported so the rule is testable without a model. */
export function withQueryPrefix(text: string): string {
  return QUERY_PREFIX ? `${QUERY_PREFIX}${text}` : text;
}

/** Prefix a document being indexed. */
export function withPassagePrefix(text: string): string {
  return PASSAGE_PREFIX ? `${PASSAGE_PREFIX}${text}` : text;
}

/**
 * How a model expects its token vectors to be pooled into one vector.
 *
 * This is not cosmetic: MiniLM is trained with mean pooling and BGE with CLS, and
 * using the wrong one quietly degrades every result — which would make a model
 * comparison measure the pooling mistake instead of the model.
 */
export const POOLING = (process.env.EMBEDDING_POOLING ?? "mean") as "mean" | "cls";

let _pipeline: FeatureExtractionPipeline | undefined;
let _loading: Promise<FeatureExtractionPipeline> | undefined;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline;
  if (!_loading) {
    _loading = pipeline("feature-extraction", EMBEDDING_MODEL).then((p) => {
      _pipeline = p;
      logger.info({ model: EMBEDDING_MODEL }, "Embedding model loaded");
      return p;
    });
  }
  return _loading;
}

function zeroVector(): number[] {
  return new Array<number>(EMBEDDING_DIM).fill(0);
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Mean-pool (+normalize) every sequence in an output tensor.
 * Accepts dims [B, seq, H] (batched) or [seq, H] (single) and returns one
 * vector per sequence in the batch.
 */
function meanPoolTensor(output: { dims?: number[]; data: Float32Array }): number[][] {
  const dims = output.dims ?? [1, output.data.length, 1];
  // 3D always means [batch, seq, hidden] (batch may be 1).
  const isBatched = dims.length >= 3;
  const b = isBatched ? (dims[0] ?? 1) : 1;
  const s = isBatched ? (dims[1] ?? 1) : (dims[0] ?? 1);
  const h = output.data.length / (b * s) || 1;
  const vectors: number[][] = [];
  for (let bb = 0; bb < b; bb++) {
    const pooled = new Array<number>(h).fill(0);
    for (let t = 0; t < s; t++) {
      const offset = (bb * s + t) * h;
      for (let k = 0; k < h; k++) {
        pooled[k] = (pooled[k] ?? 0) + (output.data[offset + k] ?? 0);
      }
    }
    for (let k = 0; k < h; k++) {
      pooled[k] = (pooled[k] ?? 0) / s;
    }
    vectors.push(normalize(pooled));
  }
  return vectors;
}

/** Take the first (CLS) token of each sequence — BGE's pooling. */
function clsTensor(output: { dims?: number[]; data: Float32Array }): number[][] {
  const dims = output.dims ?? [1, output.data.length, 1];
  const isBatched = dims.length >= 3;
  const b = isBatched ? (dims[0] ?? 1) : 1;
  const seq = isBatched ? (dims[1] ?? 1) : (dims[0] ?? 1);
  const h = isBatched ? (dims[2] ?? 1) : (dims[1] ?? 1);
  const out: number[][] = [];
  for (let i = 0; i < b; i += 1) {
    const base = i * seq * h;
    out.push(normalize(Array.from(output.data.slice(base, base + h))));
  }
  return out;
}

/** Pool a model output into one vector per sequence, per POOLING. */
function pool(output: { dims?: number[]; data: Float32Array }): number[][] {
  return POOLING === "cls" ? clsTensor(output) : meanPoolTensor(output);
}

/** Generate a single 384-dim embedding for a search *query* (see QUERY_PREFIX). */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || !text.trim()) return zeroVector();
  const extractor = await getPipeline();
  const output = await extractor(withQueryPrefix(text), { pooling: "none" });
  const tensor = Array.isArray(output) ? output[0] : output;
  return pool(tensor)[0] ?? zeroVector();
}

/** Batch-embed *documents* for indexing (see PASSAGE_PREFIX). */
export async function batchGenerateEmbeddings(
  texts: string[],
  batchSize = 32,
): Promise<number[][]> {
  const extractor = await getPipeline();
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    const output = await extractor(chunk.map((t) => withPassagePrefix(t)), { pooling: "none" });
    const tensor = Array.isArray(output) ? output[0] : output;
    const vectors = pool(tensor);
    chunk.forEach((text, idx) => {
      result.push(text && text.trim() ? (vectors[idx] ?? zeroVector()) : zeroVector());
    });
  }
  logger.info(`Generated ${result.length} embeddings`);
  return result;
}