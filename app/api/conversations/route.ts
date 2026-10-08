import * as v from "valibot";
import { createConversation, getConversationDb, listRecentSessions } from "@/lib/conversation-db";
import { parseJsonRequest } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

const STORAGE_UNCONFIGURED = "Conversation storage is not configured for this deployment.";
const SESSION_NAME_LENGTH = 20;

const messageSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  role: v.picklist(["user", "assistant"]),
  parts: v.pipe(v.array(v.unknown()), v.minLength(1)),
});

const createSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  message: messageSchema,
});

/** Session naming mirrors the old local store: first text part, truncated to 20 chars. */
const deriveSessionName = (parts: unknown[]): string => {
  const textPart = parts.find(
    (part): part is { type: "text"; text: unknown } =>
      typeof part === "object" && part !== null && "type" in part && part.type === "text",
  );
  return typeof textPart?.text === "string" && textPart.text.length > 0
    ? textPart.text.slice(0, SESSION_NAME_LENGTH)
    : "New chat";
};

const storageUnavailable = () => new Response(STORAGE_UNCONFIGURED, { status: 503 });
const storageFailed = () =>
  Response.json({ error: "Failed to access conversation storage." }, { status: 500 });

export async function GET() {
  const db = await getConversationDb();
  if (!db) {
    return storageUnavailable();
  }

  try {
    return Response.json({ sessions: await listRecentSessions(db) });
  } catch {
    return storageFailed();
  }
}

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, createSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const db = await getConversationDb();
  if (!db) {
    return storageUnavailable();
  }

  const { id, message } = parsed.data;
  const name = deriveSessionName(message.parts);
  try {
    await createConversation(db, { id, name, message });
  } catch {
    // Duplicate ids or other constraint/storage failures must not surface as
    // an uncaught error.
    return storageFailed();
  }

  return Response.json({ session: { id, name } }, { status: 201 });
}
