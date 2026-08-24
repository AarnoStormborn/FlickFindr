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
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

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

function meanPool(output: { dims?: number[]; data: Float32Array }): number[] {
  // output.dims: [batch, tokens, hidden] — take the batch-0 tensor
  const batch = output.dims?.[0] ?? 1;
  const tokens = output.dims?.[1] ?? 1;
  const hidden = output.data.length / (batch * tokens);
  const pooled = new Array<number>(hidden).fill(0);
  for (let t = 0; t < tokens; t++) {
    const offset = t * hidden;
    for (let h = 0; h < hidden; h++) {
      pooled[h] = (pooled[h] ?? 0) + (output.data[offset + h] ?? 0);
    }
  }
  for (let h = 0; h < hidden; h++) {
    pooled[h] = (pooled[h] ?? 0) / tokens;
  }
  return pooled;
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Generate a single 384-dim embedding for text. Zero vector for empty input. */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || !text.trim()) return zeroVector();
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: "none" });
  const tensor = Array.isArray(output) ? output[0] : output;
  const pooled = meanPool(tensor);
  return normalize(pooled);
}

/** Batch embedding with a fixed batch size. */
export async function batchGenerateEmbeddings(
  texts: string[],
  batchSize = 32,
): Promise<number[][]> {
  const extractor = await getPipeline();
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    const outputs = await extractor(chunk, { pooling: "none" });
    const tensors = Array.isArray(outputs) ? outputs : [outputs];
    tensors.forEach((tensor, idx) => {
      const text = chunk[idx] ?? "";
      result.push(text && text.trim() ? normalize(meanPool(tensor)) : zeroVector());
    });
  }
  logger.info(`Generated ${result.length} embeddings`);
  return result;
}