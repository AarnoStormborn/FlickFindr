import Fastify from "fastify";
import type { FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { logger } from "./logger.js";
import type { HybridSearchRequest, Queryable } from "./models.js";
import { flicksRoutes } from "./routes/flicks.js";
import { searchRoutes } from "./routes/search.js";
import { chatRoutes } from "./routes/chat.js";
import { isAgentConfigured } from "./agent/runtime.js";

export interface AppDeps {
  db: Queryable;
  embed: (text: string) => Promise<number[]>;
  /** Override the agent query parser (tests inject a stub). */
  agentParse?: (query: string) => Promise<HybridSearchRequest>;
}

/** Build the Fastify app with all routes. Injectable deps make it testable. */
export function buildApp(deps: AppDeps) {
  const serverOptions: FastifyServerOptions = {
    logger: config.logLevel !== "silent",
    // Render terminates TLS at its edge and sets X-Forwarded-For. Trust exactly
    // one hop (not `true`, which would take the leftmost, client-supplied
    // entry) so the rate limiter keys on the real client IP and cannot be
    // bypassed by forging a header.
    trustProxy: (_address: string, hop: number) => hop < 1,
  };
  const app = Fastify(serverOptions);

  void app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["*"],
    allowedHeaders: ["*"],
  });

  // The API is public and unauthenticated, and /chat spends real money (several
  // model calls per turn), so there is no protection against a single client
  // draining the provider balance or the free tier's daily quota. These are
  // coarse per-IP ceilings;
  // /chat adds a stricter per-route limit on top of the global one.
  void app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
  });

  app.get("/", async () => ({
    message: "API is running !!!",
    agent: {
      enabled: config.agent.enabled,
      // Whether a model is actually authenticated. Lets clients tell a real
      // outage from "the concierge was never switched on" without guessing.
      configured: config.agent.enabled && (await isAgentConfigured()),
    },
  }));

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
    await app.listen({ port: config.port, host: "::" });
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