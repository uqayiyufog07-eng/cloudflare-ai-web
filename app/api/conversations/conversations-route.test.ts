import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  GET as listConversations,
  POST as createConversationRoute,
} from "@/app/api/conversations/route";
import {
  DELETE as deleteConversationRoute,
  GET as getConversationRoute,
} from "@/app/api/conversations/[id]/route";
import { POST as appendMessageRoute } from "@/app/api/conversations/[id]/messages/route";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/request-limits";
import { FakeD1, loadConversationSchema } from "@/lib/testing/fake-d1";

const BASE = "https://example.com/api/conversations";
const contextRef: { env: Record<string, unknown> | null } = { env: null };

mock.module("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => {
    if (contextRef.env === null) {
      throw new Error("No Cloudflare context");
    }
    return { env: contextRef.env, ctx: { waitUntil: () => {} }, cf: undefined };
  },
}));

const createBody = (id: string, text: string) =>
  JSON.stringify({
    id,
    message: { id: `${id}-m1`, role: "user", parts: [{ type: "text", text }] },
  });

const post = (body: string) =>
  new Request(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

const contextFor = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  contextRef.env = { DB: new FakeD1(await loadConversationSchema()) };
});

afterEach(() => {
  contextRef.env = null;
});

test("GET returns 503 when the D1 binding is missing", async () => {
  contextRef.env = {};
  expect((await listConversations()).status).toBe(503);

  contextRef.env = null;
  expect((await listConversations()).status).toBe(503);
});

test("POST creates a conversation with a server-derived name and GET lists it", async () => {
  const response = await createConversationRoute(
    post(createBody("s1", "Explain D1 sync in detail please")),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    session: { id: "s1", name: "Explain D1 sync in d" },
  });

  const listed = await listConversations();
  const { sessions } = await listed.json();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ id: "s1", name: "Explain D1 sync in d" });
  expect(typeof sessions[0].updatedAt).toBe("string");
});

test("session name handles CJK text, empty text, and parts without text", async () => {
  const cases: Array<[string, unknown, string]> = [
    [
      "cjk",
      {
        id: "cjk-m",
        role: "user",
        parts: [{ type: "text", text: "一二三四五六七八九十一二三四五六七八九十十一" }],
      },
      "一二三四五六七八九十一二三四五六七八九十",
    ],
    ["empty", { id: "empty-m", role: "user", parts: [{ type: "text", text: "" }] }, "New chat"],
    [
      "no-text",
      { id: "notext-m", role: "assistant", parts: [{ type: "reasoning", text: "thinking" }] },
      "New chat",
    ],
  ];

  for (const [id, message, expectedName] of cases) {
    const response = await createConversationRoute(post(JSON.stringify({ id, message })));
    expect(response.status, `case ${id}`).toBe(201);
    expect((await response.json()).session.name, `case ${id}`).toBe(expectedName);
  }
});

test("POST rejects invalid or oversized bodies without writing anything", async () => {
  const invalidBodies = [
    JSON.stringify({ message: { id: "m", role: "user", parts: [{ type: "text", text: "x" }] } }),
    JSON.stringify({ id: "s", message: { id: "m", role: "admin", parts: [] } }),
    JSON.stringify({ id: "s", message: { id: "m", role: "user", parts: [] } }),
    "{not json",
  ];

  for (const body of invalidBodies) {
    const response = await createConversationRoute(post(body));
    expect(response.status).toBe(400);
  }

  const oversized = JSON.stringify({
    id: "s",
    message: {
      id: "m",
      role: "user",
      parts: [{ type: "text", text: "x".repeat(MAX_REQUEST_BODY_BYTES + 1024) }],
    },
  });
  expect((await createConversationRoute(post(oversized))).status).toBe(413);

  const { sessions } = await (await listConversations()).json();
  expect(sessions).toEqual([]);
});

test("full CRUD chain: create, open, append (incl. 404), delete (idempotent)", async () => {
  expect((await createConversationRoute(post(createBody("s1", "first question")))).status).toBe(
    201,
  );

  const opened = await getConversationRoute(new Request(`${BASE}/s1`), contextFor("s1"));
  expect(opened.status).toBe(200);
  const openedBody = await opened.json();
  expect(openedBody.session.id).toBe("s1");
  expect(openedBody.messages.map((m: { id: string }) => m.id)).toEqual(["s1-m1"]);

  const reply = await appendMessageRoute(
    new Request(`${BASE}/s1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { id: "s1-m2", role: "assistant", parts: [{ type: "text", text: "answer" }] },
      }),
    }),
    contextFor("s1"),
  );
  expect(reply.status).toBe(201);

  const afterAppend = await (
    await getConversationRoute(new Request(`${BASE}/s1`), contextFor("s1"))
  ).json();
  expect(afterAppend.messages.map((m: { id: string }) => m.id)).toEqual(["s1-m1", "s1-m2"]);

  const appendMissing = await appendMessageRoute(
    new Request(`${BASE}/gone/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { id: "x", role: "user", parts: [{ type: "text", text: "y" }] },
      }),
    }),
    contextFor("gone"),
  );
  expect(appendMissing.status).toBe(404);

  expect((await getConversationRoute(new Request(`${BASE}/gone`), contextFor("gone"))).status).toBe(
    404,
  );

  expect(
    (
      await deleteConversationRoute(
        new Request(`${BASE}/s1`, { method: "DELETE" }),
        contextFor("s1"),
      )
    ).status,
  ).toBe(204);
  expect(
    (
      await deleteConversationRoute(
        new Request(`${BASE}/s1`, { method: "DELETE" }),
        contextFor("s1"),
      )
    ).status,
  ).toBe(204);
  expect((await getConversationRoute(new Request(`${BASE}/s1`), contextFor("s1"))).status).toBe(
    404,
  );
  expect((await (await listConversations()).json()).sessions).toEqual([]);
});

test("every route returns 503 without the binding", async () => {
  contextRef.env = {};
  const ctx = contextFor("s1");
  expect((await listConversations()).status).toBe(503);
  expect((await createConversationRoute(post(createBody("s1", "hi")))).status).toBe(503);
  expect((await getConversationRoute(new Request(`${BASE}/s1`), ctx)).status).toBe(503);
  expect(
    (await deleteConversationRoute(new Request(`${BASE}/s1`, { method: "DELETE" }), ctx)).status,
  ).toBe(503);

  const appendRequest = new Request(`${BASE}/s1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: { id: "s1-m2", role: "assistant", parts: [{ type: "text", text: "ok" }] },
    }),
  });
  expect((await appendMessageRoute(appendRequest, ctx)).status).toBe(503);

  // No Cloudflare context at all (getCloudflareContext throws) also degrades to 503.
  contextRef.env = null;
  expect((await createConversationRoute(post(createBody("s2", "hi")))).status).toBe(503);
});

test("appending to a session deleted concurrently returns 404, not 500", async () => {
  expect((await createConversationRoute(post(createBody("s1", "first")))).status).toBe(201);
  expect(
    (
      await deleteConversationRoute(
        new Request(`${BASE}/s1`, { method: "DELETE" }),
        contextFor("s1"),
      )
    ).status,
  ).toBe(204);

  const appendRequest = new Request(`${BASE}/s1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: { id: "late", role: "assistant", parts: [{ type: "text", text: "late" }] },
    }),
  });
  expect((await appendMessageRoute(appendRequest, contextFor("s1"))).status).toBe(404);
});

test("creating a conversation with a duplicate id returns 500", async () => {
  expect((await createConversationRoute(post(createBody("s1", "first")))).status).toBe(201);
  const duplicate = await createConversationRoute(
    post(
      JSON.stringify({
        id: "s1",
        message: { id: "other-m", role: "user", parts: [{ type: "text", text: "again" }] },
      }),
    ),
  );
  expect(duplicate.status).toBe(500);
  // The rejected batch must not leave a partial write behind.
  const detail = await getConversationRoute(new Request(`${BASE}/s1`), contextFor("s1"));
  expect((await detail.json()).messages).toHaveLength(1);
});
