/**
 * Pre-warm the embedding model on container start so the first search
 * doesn't pay the one-time download/load cost. Exits once the pipeline is
 * ready; the server then starts with a warm cache.
 */
import { generateEmbedding } from "../src/embedding.js";

const probe = "warm-up";
await generateEmbedding(probe);
console.log("Embedding model warmed.");
