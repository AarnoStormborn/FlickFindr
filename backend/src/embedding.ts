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

/** Generate a single 384-dim embedding for text. Zero vector for empty input. */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || !text.trim()) return zeroVector();
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: "none" });
  const tensor = Array.isArray(output) ? output[0] : output;
  return meanPoolTensor(tensor)[0] ?? zeroVector();
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
    const output = await extractor(chunk, { pooling: "none" });
    const tensor = Array.isArray(output) ? output[0] : output;
    const vectors = meanPoolTensor(tensor);
    chunk.forEach((text, idx) => {
      result.push(text && text.trim() ? (vectors[idx] ?? zeroVector()) : zeroVector());
    });
  }
  logger.info(`Generated ${result.length} embeddings`);
  return result;
}