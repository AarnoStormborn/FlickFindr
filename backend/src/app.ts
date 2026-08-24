import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { HybridSearchRequest, Queryable } from "./models.js";
import { flicksRoutes } from "./routes/flicks.js";
import { searchRoutes } from "./routes/search.js";
import { chatRoutes } from "./routes/chat.js";

export interface AppDeps {
  db: Queryable;
  embed: (text: string) => Promise<number[]>;
  /** Override the agent query parser (tests inject a stub). */
  agentParse?: (query: string) => Promise<HybridSearchRequest>;
}

/** Build the Fastify app with all routes. Injectable deps make it testable. */
export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: config.logLevel !== "silent" });

  void app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["*"],
    allowedHeaders: ["*"],
  });

  app.get("/", async () => ({ message: "API is running !!!" }));

  app.register(async (instance) => {
    flicksRoutes(instance, { db: deps.db });
    searchRoutes(instance, { db: deps.db, embed: deps.embed, agentParse: deps.agentParse });
    if (config.agent.enabled) {
      chatRoutes(instance, { db: deps.db, embed: deps.embed });
    }
  });

  return app;
}

export async function startServer(deps: AppDeps): Promise<ReturnType<typeof buildApp>> {
  const app = buildApp(deps);
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info({ port: config.port }, "FlickFindr API listening");
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
  const shutdown = async () => {
    logger.info("Shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return app;
}