/**
 * Server-side data layer for Conversation History in Cloudflare D1.
 *
 * Every function takes the D1 binding explicitly so it can be unit-tested with
 * an in-memory double (see lib/testing/fake-d1.ts). Timestamps are ISO-8601
 * strings generated here on the server; parts are stored verbatim as JSON text.
 *
 * Like the KV layer (lib/api-keys.ts), the binding is read through
 * getCloudflareContext and its absence degrades gracefully to undefined.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export const RECENT_SESSIONS_LIMIT = 100;
export const CONVERSATION_MESSAGES_LIMIT = 100;

export type MessageRole = "user" | "assistant";

export interface MessageInput {
  id: string;
  role: MessageRole;
  parts: unknown[];
}

export interface ConversationSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole;
  parts: unknown[];
  sessionId: string;
  createdAt: string;
}

export type AppendResult = "ok" | "session-not-found";

interface SessionRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  parts: string;
  created_at: string;
}

interface D1RunResult {
  success: boolean;
  meta: { changes: number };
}

/** Minimal structural type for the D1 binding surface used by this module. */
interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface ConversationDb {
  prepare(query: string): PreparedStatement;
  batch(statements: PreparedStatement[]): Promise<D1RunResult[]>;
}

export const getConversationDb = async (): Promise<ConversationDb | undefined> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as { DB?: ConversationDb }).DB;
  } catch {
    // No Cloudflare request context (local dev without init, tests, build-time).
    return undefined;
  }
};

const nowIso = () => new Date().toISOString();

const toSession = (row: SessionRow): ConversationSession => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Rows whose parts JSON is corrupt are skipped rather than failing the whole read. */
const toMessage = (row: MessageRow): ConversationMessage | null => {
  try {
    const parts = JSON.parse(row.parts);
    if (!Array.isArray(parts)) {
      return null;
    }
    return {
      id: row.id,
      role: row.role as MessageRole,
      parts,
      sessionId: row.session_id,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
};

export interface CreateConversationInput {
  id: string;
  name: string;
  message: MessageInput;
}

/** Atomically writes the session row and its first user message. */
export const createConversation = async (
  db: ConversationDb,
  { id, name, message }: CreateConversationInput,
): Promise<void> => {
  const now = nowIso();
  await db.batch([
    db
      .prepare("INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(id, name, now, now),
    db
      .prepare(
        "INSERT INTO messages (id, session_id, role, parts, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(message.id, id, message.role, JSON.stringify(message.parts), now),
  ]);
};

export const getSession = async (
  db: ConversationDb,
  sessionId: string,
): Promise<ConversationSession | null> => {
  const row = await db
    .prepare("SELECT id, name, created_at, updated_at FROM sessions WHERE id = ?1")
    .bind(sessionId)
    .first<SessionRow>();
  return row ? toSession(row) : null;
};

/**
 * Appends a message and bumps the session in one transaction. The conditional
 * INSERT...WHERE EXISTS plus the UPDATE row count make the existence check
 * atomic: a session deleted by another device mid-request yields
 * "session-not-found" instead of a foreign-key 500.
 */
export const appendMessage = async (
  db: ConversationDb,
  sessionId: string,
  message: MessageInput,
): Promise<AppendResult> => {
  const now = nowIso();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO messages (id, session_id, role, parts, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5
         WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?2)`,
      )
      .bind(message.id, sessionId, message.role, JSON.stringify(message.parts), now),
    db.prepare("UPDATE sessions SET updated_at = ?1 WHERE id = ?2").bind(now, sessionId),
  ]);
  return results[1]?.meta.changes ? "ok" : "session-not-found";
};

/** Most recently updated sessions first; capped to match the old local store. */
export const listRecentSessions = async (db: ConversationDb): Promise<ConversationSession[]> => {
  const { results } = await db
    .prepare(
      "SELECT id, name, created_at, updated_at FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT ?1",
    )
    .bind(RECENT_SESSIONS_LIMIT)
    .all<SessionRow>();
  return results.map(toSession);
};

/**
 * Returns the newest messages of a session in chronological order.
 * Same-millisecond writes keep insertion order thanks to the rowid tiebreaker.
 */
export const loadMessages = async (
  db: ConversationDb,
  sessionId: string,
): Promise<ConversationMessage[]> => {
  const { results } = await db
    .prepare(
      "SELECT id, session_id, role, parts, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2",
    )
    .bind(sessionId, CONVERSATION_MESSAGES_LIMIT)
    .all<MessageRow>();
  return results
    .reverse()
    .map(toMessage)
    .filter((message): message is ConversationMessage => message !== null);
};

/** Deletes the session and its messages in one transaction; idempotent. */
export const deleteConversation = async (db: ConversationDb, sessionId: string): Promise<void> => {
  await db.batch([
    db.prepare("DELETE FROM messages WHERE session_id = ?1").bind(sessionId),
    db.prepare("DELETE FROM sessions WHERE id = ?1").bind(sessionId),
  ]);
};
