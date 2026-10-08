/**
 * Client-side Conversation History backed by the D1-powered REST API.
 *
 * This is the cloud counterpart of the old Dexie store: same function shapes
 * (createConversation, appendConversationMessage, loadConversationHistory,
 * listRecentSessions, deleteConversation), but every read/write goes through
 * the Worker. Successful writes/deletes dispatch a `cf-ai:conversations-changed`
 * event on the current window so the sidebar re-fetches, including after
 * cross-device changes picked up on window focus.
 */

import { type FileUIPart, generateId, type UIMessage } from "ai";

export const CONVERSATIONS_CHANGED_EVENT = "cf-ai:conversations-changed";

export interface RemoteSession {
  id: string;
  name: string;
  updatedAt: string;
}

/**
 * A conversation message as returned by the API (parts left opaque to this layer).
 * The server sends createdAt as an ISO string, whereas UIMessage types it as Date.
 */
export type RemoteStoredMessage = Omit<UIMessage, "createdAt"> & {
  sessionId: string;
  createdAt: string;
};

const API_PREFIX = "/api/conversations";

export const createUserMessage = (text: string, files: FileUIPart[] = []): UIMessage => ({
  id: generateId(),
  role: "user",
  parts: [...files, { type: "text", text }],
});

/** Error whose message the UI maps onto the existing password dialog. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

const send = async (path: string, options: { method?: string; body?: unknown } = {}) => {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Conversation request failed (${response.status}).`);
  }
  return response;
};

const notifyChanged = () => {
  (globalThis as { dispatchEvent?: (event: Event) => void }).dispatchEvent?.(
    new CustomEvent(CONVERSATIONS_CHANGED_EVENT),
  );
};

/** Starts a conversation with its first user message and returns the session id. */
export const createConversation = async (firstMessage: UIMessage): Promise<string> => {
  const sessionId = crypto.randomUUID();
  await send("", {
    method: "POST",
    body: {
      id: sessionId,
      message: {
        id: firstMessage.id,
        role: firstMessage.role,
        parts: firstMessage.parts,
      },
    },
  });
  notifyChanged();
  return sessionId;
};

export const appendConversationMessage = async (sessionId: string, message: UIMessage) => {
  await send(`/${sessionId}/messages`, {
    method: "POST",
    body: {
      message: {
        id: message.id,
        role: message.role,
        parts: message.parts,
      },
    },
  });
  notifyChanged();
};

export const loadConversationHistory = async (
  sessionId: string,
): Promise<RemoteStoredMessage[]> => {
  const response = await send(`/${sessionId}`);
  const body = (await response.json()) as { messages: RemoteStoredMessage[] };
  return body.messages;
};

export const listRecentSessions = async (): Promise<RemoteSession[]> => {
  const response = await send("");
  const body = (await response.json()) as { sessions: RemoteSession[] };
  return body.sessions;
};

export const deleteConversation = async (sessionId: string) => {
  await send(`/${sessionId}`, { method: "DELETE" });
  notifyChanged();
};
