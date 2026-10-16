import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../src/models.js";
import { buildApp } from "../src/app.js";
import { mergeSyncData } from "../src/routes/account.js";
import type { AuthResult } from "../src/services/supabaseAuth.js";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

type TestMovie = { id: number; title: string; addedAt?: number };
type TestList = { id: string; name: string; createdAt: number; movies: TestMovie[] };
type TestSync = {
  lists: { v: 1; lists: TestList[] };
  searchHistory: { label: string; mode: string; params: string; ts: number }[];
  transcript: { role: "user" | "assistant"; content: string; movies?: { id: number; movie_name: string }[] }[];
};

const empty = (): TestSync => ({
  lists: { v: 1, lists: [{ id: "watch-later", name: "Watch later", createdAt: 0, movies: [] }] },
  searchHistory: [],
  transcript: [],
});

const authOk = async (): Promise<AuthResult> => ({ ok: true, user: { id: USER, email: "viewer@example.com" } });

function fakeDb(initial?: { user_id: string; data: unknown; revision: number; updated_at: Date }) {
  let stored = initial;
  const queries: { sql: string; params: unknown[] }[] = [];
  const db: Queryable = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT data, revision")) {
        // Enforce owner scoping in the fake as well as inspect the SQL below.
        return { rows: stored && stored.user_id === params[0] ? [stored] : [] };
      }
      if (sql.startsWith("INSERT INTO user_sync_data")) {
        const userId = String(params[0]);
        const data = JSON.parse(String(params[1]));
        const revision = stored?.user_id === userId ? stored.revision + 1 : 1;
        stored = { user_id: userId, data, revision, updated_at: new Date("2026-10-01T00:00:00Z") };
        return { rows: [{ revision, updated_at: stored.updated_at }] };
      }
      return { rows: [] };
    },
  };
  return { db, queries, get stored() { return stored; } };
}

async function testApp(db: Queryable, verify: () => Promise<AuthResult> = authOk) {
  const app = buildApp({ db, embed: async () => [], authVerify: verify as never });
  await app.ready();
  return app;
}

describe("mergeSyncData", () => {
  it("unions guest lists and movie snapshots without duplicating the default", () => {
    const remote = empty();
    remote.lists.lists[0]!.movies = [{ id: 1, title: "Arrival", addedAt: 10 }];
    remote.lists.lists.push({ id: "remote-list", name: "Sci-Fi", createdAt: 2, movies: [{ id: 2, title: "Dune", addedAt: 5 }] });
    const guest = empty();
    guest.lists.lists[0]!.movies = [{ id: 1, title: "Arrival", addedAt: 12 }, { id: 3, title: "Moon", addedAt: 7 }];
    guest.lists.lists.push({ id: "guest-list", name: "Watch with Sam", createdAt: 3, movies: [] });

    const merged = mergeSyncData(remote, guest);
    expect(merged.lists.lists).toHaveLength(3);
    expect(merged.lists.lists.filter((l) => l.id === "watch-later")).toHaveLength(1);
    expect(merged.lists.lists.find((l) => l.id === "watch-later")?.movies.map((m) => m.id).sort()).toEqual([1, 3]);
    expect(merged.lists.lists.find((l) => l.id === "watch-later")?.movies.find((m) => m.id === 1)?.addedAt).toBe(12);
  });

  it("deduplicates history by params and keeps the newest 25", () => {
    const remote = empty();
    const guest = empty();
    remote.searchHistory.push({ label: "old", mode: "semantic", params: "q=old", ts: 1 });
    guest.searchHistory.push({ label: "new", mode: "semantic", params: "q=old", ts: 100 });
    for (let i = 0; i < 30; i++) guest.searchHistory.push({ label: `q${i}`, mode: "structural", params: `q=${i}`, ts: 10 + i });
    const merged = mergeSyncData(remote, guest);
    expect(merged.searchHistory).toHaveLength(25);
    expect(merged.searchHistory[0]?.label).toBe("new");
    expect(merged.searchHistory.filter((h) => h.params === "q=old")).toHaveLength(1);
  });

  it("merges transcript messages idempotently and caps at 40", () => {
    const remote = empty();
    const guest = empty();
    remote.transcript.push({ role: "user", content: "Recommend a film" }, { role: "assistant", content: "Try Arrival" });
    guest.transcript.push({ role: "user", content: "Recommend a film" }, { role: "assistant", content: "Try Arrival" }, { role: "user", content: "More like that" });
    const merged = mergeSyncData(remote, guest);
    expect(merged.transcript).toEqual([
      { role: "user", content: "Recommend a film" },
      { role: "assistant", content: "Try Arrival" },
      { role: "user", content: "More like that" },
    ]);
    expect(mergeSyncData(merged, guest)).toEqual(merged);
  });
});

describe("account sync API", () => {
  it("reports when Auth is not configured instead of treating it as an invalid session", async () => {
    // Tests do not load a developer .env; no Supabase Auth credentials here. The
    // client can distinguish "not configured on this deployment" from a bad token.
    const { db } = fakeDb();
    const verify = async (): Promise<AuthResult> => ({ ok: false, reason: "not-configured" });
    const app = await testApp(db, verify);
    const res = await app.inject({ method: "GET", url: "/account/sync", headers: { authorization: "Bearer token" } });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toMatch(/not configured/i);
    await app.close();
  });

  it("requires a bearer token", async () => {
    const { db } = fakeDb();
    const app = await testApp(db);
    const res = await app.inject({ method: "GET", url: "/account/sync" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("scopes reads by the user from verified auth, never a caller-supplied id", async () => {
    const data = empty();
    data.lists.lists[0]!.movies.push({ id: 1, title: "Arrival", addedAt: 1 });
    const { db, queries } = fakeDb({ user_id: USER, data, revision: 4, updated_at: new Date("2026-10-01T00:00:00Z") });
    const app = await testApp(db);
    const res = await app.inject({ method: "GET", url: `/account/sync?user_id=${OTHER}`, headers: { authorization: "Bearer signed-in-token" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.lists.lists[0].movies[0].title).toBe("Arrival");
    expect(queries[0]?.params).toEqual([USER]);
    expect(queries[0]?.sql).toContain("WHERE user_id = $1");
    await app.close();
  });

  it("returns empty defaults for a newly signed-in user", async () => {
    const { db } = fakeDb();
    const app = await testApp(db);
    const res = await app.inject({ method: "GET", url: "/account/sync", headers: { authorization: "Bearer token" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision).toBe(0);
    expect(res.json().data.lists.lists[0].id).toBe("watch-later");
    await app.close();
  });

  it("merges guest data into the authenticated user's snapshot", async () => {
    const remote = empty();
    remote.lists.lists[0]!.movies.push({ id: 1, title: "Arrival", addedAt: 1 });
    const { db, queries } = fakeDb({ user_id: USER, data: remote, revision: 2, updated_at: new Date() });
    const app = await testApp(db);
    const guest = empty();
    guest.lists.lists[0]!.movies.push({ id: 2, title: "Dune", addedAt: 2 });
    const res = await app.inject({ method: "POST", url: "/account/sync/merge", headers: { authorization: "Bearer token" }, payload: guest });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.lists.lists[0].movies.map((m: { id: number }) => m.id).sort()).toEqual([1, 2]);
    const write = queries.find((q) => q.sql.startsWith("INSERT INTO user_sync_data"));
    expect(write?.params[0]).toBe(USER);
    await app.close();
  });

  it("rejects malformed and oversized payloads", async () => {
    const { db, queries } = fakeDb();
    const app = await testApp(db);
    const res = await app.inject({ method: "PUT", url: "/account/sync", headers: { authorization: "Bearer token" }, payload: { lists: { v: 99, lists: [] }, searchHistory: [], transcript: [] } });
    expect(res.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
    await app.close();
  });

  it("does not trust an invalid Supabase token", async () => {
    const { db, queries } = fakeDb();
    const verify = async () => ({ ok: false as const, reason: "invalid" as const });
    const app = await testApp(db, verify);
    const res = await app.inject({ method: "GET", url: "/account/sync", headers: { authorization: "Bearer invalid" } });
    expect(res.statusCode).toBe(401);
    expect(queries).toHaveLength(0);
    await app.close();
  });
});
