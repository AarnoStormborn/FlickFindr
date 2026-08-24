import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Queryable } from "../models.js";
import { createChatRunner } from "../agent/chat.js";

const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(50)
    .optional(),
});

export function chatRoutes(app: FastifyInstance, deps: { db: Queryable; embed: (text: string) => Promise<number[]> }): void {
  const { db, embed } = deps;

  app.post("/chat", async (request, reply) => {
    if (!config.agent.enabled) {
      return reply.code(503).send({ detail: "Agent chat is disabled (AGENT_ENABLED=false)" });
    }
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ detail: parsed.error.issues[0]?.message ?? "Invalid request" });
    }

    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write("retry: 3000\n\n");

    let runner: Awaited<ReturnType<typeof createChatRunner>> | undefined;
    let closed = false;
    const send = (obj: Record<string, unknown>) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);

    const close = () => {
      if (closed) return;
      closed = true;
      try {
        raw.end();
      } catch {
        /* noop */
      }
    };
    const abortTimer = setTimeout(() => {
      logger.warn("Chat timeout; aborting agent");
      void runner?.abort();
    }, config.agent.chatTimeoutMs);
    raw.on("close", () => {
      clearTimeout(abortTimer);
      void runner?.abort();
      close();
    });

    try {
      runner = await createChatRunner(db, embed, {
        onDelta: (delta) => send({ delta }),
        onError: (message) => send({ error: message }),
        onDone: () => send({ done: true }),
      });
      await runner.run(parsed.data.message, parsed.data.history ?? []);
      send({ done: true });
    } catch (err) {
      logger.error({ err }, "Chat failed");
      send({ error: err instanceof Error ? err.message : "Chat failed" });
    } finally {
      clearTimeout(abortTimer);
      runner?.dispose();
      close();
    }
  });
}