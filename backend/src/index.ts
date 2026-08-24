import { startServer } from "./app.js";
import { db } from "./db/pool.js";
import { generateEmbedding } from "./embedding.js";

await startServer({ db, embed: generateEmbedding });