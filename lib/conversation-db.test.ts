import { afterEach, expect, setSystemTime, test } from "bun:test";
import {
  appendMessage,
  CONVERSATION_MESSAGES_LIMIT,
  createConversation,
  deleteConversation,
  getSession,
  listRecentSessions,
  loadMessages,
  RECENT_SESSIONS_LIMIT,
  type MessageInput,
} from "@/lib/conversation-db";
import { FakeD1, loadConversationSchema } from "@/lib/testing/fake-d1";

let db: FakeD1;

const userMessage = (text: string, index: number): MessageInput => ({
  id: `msg-${index}`,
  role: "user",
  parts: [{ type: "text", text }],
});

afterEach(() => {
  setSystemTime();
});

test("createConversation stores the session and first message atomically", async () => {
  db = new FakeD1(await loadConversationSchema());
  setSystemTime(new Date("2026-10-07T10:00:00.000Z"));

  await createConversation(db, { id: "s1", name: "hello world", message: userMessage("hello", 1) });

  const session = await getSession(db, "s1");
  expect(session).toMatchObject({ id: "s1", name: "hello world" });
  expect(session?.createdAt).toBe("2026-10-07T10:00:00.000Z");
  expect(session?.updatedAt).toBe(session?.createdAt);

  const messages = await loadMessages(db, "s1");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    id: "msg-1",
    role: "user",
    sessionId: "s1",
    parts: [{ type: "text", text: "hello" }],
  });
  expect(messages[0].createdAt).toBe(session!.createdAt);
});

test("appendMessage keeps insertion order within the same millisecond via the rowid tiebreaker", async () => {
  db = new FakeD1(await loadConversationSchema());
  setSystemTime(new Date("2026-10-07T10:00:00.000Z"));
  await createConversation(db, { id: "s1", name: "first", message: userMessage("one", 1) });

  await appendMessage(db, "s1", { id: "reply-1", role: "assistant", parts: [] });
  await appendMessage(db, "s1", userMessage("two", 2));
  await appendMessage(db, "s1", { id: "reply-2", role: "assistant", parts: [] });

  const messages = await loadMessages(db, "s1");
  expect(messages.map((message) => message.id)).toEqual(["msg-1", "reply-1", "msg-2", "reply-2"]);
});

test("appendMessage bumps updatedAt and rejects an unknown session", async () => {
  db = new FakeD1(await loadConversationSchema());
  setSystemTime(new Date("2026-10-07T10:00:00.000Z"));
  await createConversation(db, { id: "s1", name: "first", message: userMessage("one", 1) });

  setSystemTime(new Date("2026-10-07T11:30:00.000Z"));
  expect(await appendMessage(db, "s1", { id: "reply", role: "assistant", parts: [] })).toBe("ok");
  expect((await getSession(db, "s1"))?.updatedAt).toBe("2026-10-07T11:30:00.000Z");

  expect(await appendMessage(db, "missing", userMessage("x", 2))).toBe("session-not-found");
  expect(await getSession(db, "missing")).toBeNull();
});

test("loadMessages returns only the newest 100 messages in chronological order", async () => {
  db = new FakeD1(await loadConversationSchema());
  setSystemTime(new Date(Date.UTC(2026, 0, 1)));
  await createConversation(db, { id: "s1", name: "s1", message: userMessage("m0", 0) });
  for (let index = 1; index <= CONVERSATION_MESSAGES_LIMIT + 4; index++) {
    setSystemTime(new Date(Date.UTC(2026, 0, 1) + index * 1000));
    await appendMessage(db, "s1", userMessage(`m${index}`, index));
  }

  const messages = await loadMessages(db, "s1");
  expect(messages).toHaveLength(CONVERSATION_MESSAGES_LIMIT);
  expect(messages[0].id).toBe("msg-5");
  expect(messages.at(-1)?.id).toBe(`msg-${CONVERSATION_MESSAGES_LIMIT + 4}`);
});

test("listRecentSessions returns at most 100 sessions, most recently updated first", async () => {
  db = new FakeD1(await loadConversationSchema());
  const total = RECENT_SESSIONS_LIMIT + 5;
  for (let index = 0; index < total; index++) {
    setSystemTime(new Date(Date.UTC(2026, 0, 1) + index * 1000));
    await createConversation(db, {
      id: `s${index}`,
      name: `session ${index}`,
      message: userMessage("hi", index),
    });
  }

  const sessions = await listRecentSessions(db);
  expect(sessions).toHaveLength(RECENT_SESSIONS_LIMIT);
  expect(sessions[0].name).toBe(`session ${total - 1}`);
  expect(sessions.at(-1)?.name).toBe("session 5");
});

test("deleteConversation cascades to messages and is idempotent", async () => {
  db = new FakeD1(await loadConversationSchema());
  await createConversation(db, { id: "keep", name: "keep", message: userMessage("keep", 1) });
  await createConversation(db, { id: "drop", name: "drop", message: userMessage("drop", 2) });

  await deleteConversation(db, "drop");
  await deleteConversation(db, "drop");

  expect(await getSession(db, "drop")).toBeNull();
  expect(await loadMessages(db, "drop")).toEqual([]);
  expect((await listRecentSessions(db)).map((session) => session.id)).toEqual(["keep"]);
  expect(await loadMessages(db, "keep")).toHaveLength(1);
});

test("loadMessages skips rows with corrupt parts JSON", async () => {
  db = new FakeD1(await loadConversationSchema());
  await createConversation(db, { id: "s1", name: "s1", message: userMessage("good", 1) });
  db.executeRaw(
    "INSERT INTO messages (id, session_id, role, parts, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    "bad",
    "s1",
    "assistant",
    "{not json",
    new Date().toISOString(),
  );

  const messages = await loadMessages(db, "s1");
  expect(messages.map((message) => message.id)).toEqual(["msg-1"]);
});
