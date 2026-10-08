import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  appendConversationMessage,
  CONVERSATIONS_CHANGED_EVENT,
  createConversation,
  createUserMessage,
  deleteConversation,
  listRecentSessions,
  loadConversationHistory,
  UnauthorizedError,
} from "@/lib/conversation-api";

interface CapturedRequest {
  url: string;
  method: string;
  contentType: string | null;
  body: unknown;
}

let requests: CapturedRequest[] = [];
let responseStatus = 200;
let responseBody: unknown = {};
let changedCount = 0;

const onChanged = () => {
  changedCount += 1;
};

beforeEach(() => {
  requests = [];
  changedCount = 0;
  responseStatus = 200;
  responseBody = {};
  globalThis.addEventListener(CONVERSATIONS_CHANGED_EVENT, onChanged);

  globalThis.fetch = mock(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(input),
      method: init.method ?? "GET",
      contentType: init.headers ? new Headers(init.headers).get("content-type") : null,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(
      typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
      {
        status: responseStatus,
        headers: { "content-type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.removeEventListener(CONVERSATIONS_CHANGED_EVENT, onChanged);
});

test("createConversation POSTs the first message and returns the new session id", async () => {
  const first = createUserMessage("hello");
  const sessionId = await createConversation(first);

  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    url: "/api/conversations",
    method: "POST",
    contentType: "application/json",
  });
  expect(requests[0].body).toEqual({
    id: sessionId,
    message: { id: first.id, role: "user", parts: first.parts },
  });
  expect(changedCount).toBe(1);
});

test("appendConversationMessage POSTs the message and notifies once", async () => {
  responseStatus = 201;
  await appendConversationMessage("s1", {
    id: "m2",
    role: "assistant",
    parts: [{ type: "text", text: "hi" }],
  });

  expect(requests[0]).toMatchObject({
    url: "/api/conversations/s1/messages",
    method: "POST",
  });
  expect(requests[0].body).toEqual({
    message: { id: "m2", role: "assistant", parts: [{ type: "text", text: "hi" }] },
  });
  expect(changedCount).toBe(1);
});

test("reads use GET, unwrap the response envelopes, and do not notify", async () => {
  responseBody = {
    session: { id: "s1" },
    messages: [{ id: "m1", role: "user", parts: [], sessionId: "s1", createdAt: "t" }],
  };
  const messages = await loadConversationHistory("s1");
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ id: "m1", sessionId: "s1" });

  responseBody = {
    sessions: [{ id: "s1", name: "n", updatedAt: "t" }],
  };
  const sessions = await listRecentSessions();
  expect(sessions).toEqual([{ id: "s1", name: "n", updatedAt: "t" }]);

  expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
  expect(changedCount).toBe(0);
});

test("deleteConversation sends DELETE and notifies", async () => {
  responseStatus = 204;
  responseBody = "";
  await deleteConversation("s1");

  expect(requests[0]).toMatchObject({ url: "/api/conversations/s1", method: "DELETE" });
  expect(changedCount).toBe(1);
});

test("a 401 rejects with UnauthorizedError and does not notify", async () => {
  responseStatus = 401;
  responseBody = "Unauthorized";

  const first = createUserMessage("hello");
  await expect(createConversation(first)).rejects.toBeInstanceOf(UnauthorizedError);
  await expect(loadConversationHistory("s1")).rejects.toMatchObject({ message: "Unauthorized" });
  expect(changedCount).toBe(0);
});

test("other error statuses surface the server message", async () => {
  responseStatus = 503;
  responseBody = "Conversation storage is not configured for this deployment.";

  await expect(listRecentSessions()).rejects.toThrow(
    "Conversation storage is not configured for this deployment.",
  );
});
