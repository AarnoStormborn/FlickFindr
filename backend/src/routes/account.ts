import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Queryable } from "../models.js";
import { logger } from "../logger.js";
import { verifySupabaseToken } from "../services/supabaseAuth.js";

const MovieSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(500),
  poster: z.string().max(2_000).nullable().optional(),
  year: z.number().int().min(1880).max(2100).nullable().optional(),
  rating: z.number().min(0).max(10).nullable().optional(),
  addedAt: z.number().int().nonnegative().optional(),
});

const ListSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  createdAt: z.number().int().nonnegative(),
  movies: z.array(MovieSchema).max(5_000),
});

const HistorySchema = z.object({
  label: z.string().min(1).max(300),
  mode: z.string().min(1).max(30),
  params: z.string().max(2_000),
  ts: z.number().int().nonnegative(),
});

const TranscriptMovieSchema = z.object({
  id: z.number().int().positive(),
  movie_name: z.string().min(1).max(500),
  release_year: z.number().int().nullable().optional(),
  rating: z.number().nullable().optional(),
  runtime: z.number().int().nullable().optional(),
  genre: z.string().nullable().optional(),
  poster_url: z.string().max(2_000).nullable().optional(),
});

const TranscriptMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
  movies: z.array(TranscriptMovieSchema).max(20).optional(),
});

const SyncDataSchema = z.object({
  lists: z.object({ v: z.literal(1), lists: z.array(ListSchema).max(100) }),
  searchHistory: z.array(HistorySchema).max(25),
  transcript: z.array(TranscriptMessageSchema).max(40),
}).superRefine((value, ctx) => {
  // Bound the total JSON payload as well as each field, so a valid shape cannot
  // still be used to push an arbitrarily large object into the row.
  if (JSON.stringify(value).length > 1_000_000) {
    ctx.addIssue({ code: "custom", message: "Sync payload exceeds 1 MB" });
  }
});

type SyncData = z.infer<typeof SyncDataSchema>;

const DEFAULT_DATA: SyncData = {
  lists: { v: 1, lists: [{ id: "watch-later", name: "Watch later", createdAt: 0, movies: [] }] },
  searchHistory: [],
  transcript: [],
};

interface SyncRow {
  data: unknown;
  revision: number;
  updated_at: Date | string;
}

const parseBody = (body: unknown) => SyncDataSchema.safeParse(body);

function messageKey(m: SyncData["transcript"][number]): string {
  return JSON.stringify([m.role, m.content, (m.movies ?? []).map((x) => x.id)]);
}

/**
 * Merge guest localStorage into the signed-in account on first sign-in.
 *
 * Lists merge by id; movies merge by movie id; history merges by URL params and
 * keeps the newest 25. Transcripts have no timestamps in the v1 local format, so
 * an exact common prefix is de-duplicated and the guest's continuation is appended;
 * differing messages are retained rather than silently discarded. All operations
 * are idempotent, so a retry after a lost response is safe.
 */
export function mergeSyncData(remote: SyncData, guest: SyncData): SyncData {
  const byId = new Map(remote.lists.lists.map((list) => [list.id, list]));
  for (const local of guest.lists.lists) {
    const existing = byId.get(local.id);
    if (!existing) {
      byId.set(local.id, local);
      continue;
    }
    const movies = new Map(existing.movies.map((movie) => [movie.id, movie]));
    for (const movie of local.movies) {
      const prior = movies.get(movie.id);
      if (!prior || (movie.addedAt ?? 0) >= (prior.addedAt ?? 0)) movies.set(movie.id, movie);
    }
    // If two independently-created lists somehow share an id, preserve the remote
    // name (it is already the account's copy) and union their movie snapshots.
    byId.set(local.id, { ...local, ...existing, movies: [...movies.values()] });
  }
  if (!byId.has("watch-later")) byId.set("watch-later", DEFAULT_DATA.lists.lists[0]!);

  const history = new Map<string, SyncData["searchHistory"][number]>();
  for (const item of [...remote.searchHistory, ...guest.searchHistory]) {
    const prior = history.get(item.params);
    if (!prior || item.ts >= prior.ts) history.set(item.params, item);
  }

  const transcript: SyncData["transcript"] = [];
  const seen = new Set<string>();
  for (const item of [...remote.transcript, ...guest.transcript]) {
    const key = messageKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    transcript.push(item);
  }

  return {
    lists: { v: 1, lists: [...byId.values()] },
    searchHistory: [...history.values()].sort((a, b) => b.ts - a.ts).slice(0, 25),
    transcript: transcript.slice(-40),
  };
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply,
  verifyToken: typeof verifySupabaseToken,
): Promise<string | null> {
  const token = bearer(request);
  if (!token) {
    reply.code(401).send({ detail: "Sign in to sync your account" });
    return null;
  }
  const auth = await verifyToken(token);
  if (!auth.ok) {
    if (auth.reason === "not-configured") {
      reply.code(503).send({ detail: "Account sync is not configured on this server" });
    } else if (auth.reason === "unavailable") {
      reply.code(503).send({ detail: "Authentication service unavailable, try again" });
    } else {
      reply.code(401).send({ detail: "Your session is invalid or expired; sign in again" });
    }
    return null;
  }
  return auth.user.id;
}

async function loadData(db: Queryable, userId: string): Promise<{ data: SyncData; revision: number; updatedAt: string | null }> {
  const { rows } = await db.query(
    "SELECT data, revision, updated_at FROM user_sync_data WHERE user_id = $1",
    [userId],
  );
  const row = rows[0] as SyncRow | undefined;
  if (!row) return { data: DEFAULT_DATA, revision: 0, updatedAt: null };
  const parsed = parseBody(row.data);
  return {
    data: parsed.success ? parsed.data : DEFAULT_DATA,
    revision: Number(row.revision),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function storeData(db: Queryable, userId: string, data: SyncData): Promise<{ revision: number; updatedAt: string | null }> {
  // `user_id` is always taken from the verified Supabase token, never the request body.
  // An upsert is atomic per account; revision lets clients observe concurrent-device
  // writes, while last-write-wins is acceptable for this v1 local-first cache.
  const { rows } = await db.query(
    `INSERT INTO user_sync_data (user_id, data, revision, updated_at)
     VALUES ($1, $2::jsonb, 1, now())
     ON CONFLICT (user_id) DO UPDATE
       SET data = EXCLUDED.data,
           revision = user_sync_data.revision + 1,
           updated_at = now()
     RETURNING revision, updated_at`,
    [userId, JSON.stringify(data)],
  );
  const row = rows[0] as { revision: number; updated_at: Date | string } | undefined;
  return { revision: Number(row?.revision ?? 1), updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null };
}

export function accountRoutes(
  app: FastifyInstance,
  db: Queryable,
  verifyToken: typeof verifySupabaseToken = verifySupabaseToken,
): void {
  app.get("/account/sync", async (request, reply) => {
    const userId = await requireUser(request, reply, verifyToken);
    if (!userId) return;
    try {
      const current = await loadData(db, userId);
      return { ...current, data: current.data };
    } catch (err) {
      logger.error({ err }, "Account sync read failed");
      return reply.code(500).send({ detail: "Could not load synced data" });
    }
  });

  app.post("/account/sync/merge", async (request, reply) => {
    const userId = await requireUser(request, reply, verifyToken);
    if (!userId) return;
    const guest = parseBody(request.body);
    if (!guest.success) return reply.code(400).send({ detail: guest.error.issues[0]?.message ?? "Invalid sync data" });
    try {
      const current = await loadData(db, userId);
      const merged = mergeSyncData(current.data, guest.data);
      const stored = await storeData(db, userId, merged);
      return { data: merged, ...stored };
    } catch (err) {
      logger.error({ err }, "Account data merge failed");
      return reply.code(500).send({ detail: "Could not merge local data" });
    }
  });

  app.put("/account/sync", async (request, reply) => {
    const userId = await requireUser(request, reply, verifyToken);
    if (!userId) return;
    const parsed = parseBody(request.body);
    if (!parsed.success) return reply.code(400).send({ detail: parsed.error.issues[0]?.message ?? "Invalid sync data" });
    try {
      const stored = await storeData(db, userId, parsed.data);
      return { data: parsed.data, ...stored };
    } catch (err) {
      logger.error({ err }, "Account sync write failed");
      return reply.code(500).send({ detail: "Could not sync account data" });
    }
  });
}
