import { startServer } from "./app.js";
import { db } from "./db/pool.js";
import { generateEmbedding } from "./embedding.js";
import { logger } from "./logger.js";

// Kick off the embedding-model warm-up in the background so the first real
// search doesn't pay the one-time model download/load cost. Server boots
// immediately; the model warms concurrently.
void generateEmbedding("warm-up")
  .then(() => logger.info("Embedding model pre-warmed (background)"))
  .catch((err) => logger.warn({ err }, "Embedding pre-warm failed (will load lazily)"));

await startServer({ db, embed: generateEmbedding });
