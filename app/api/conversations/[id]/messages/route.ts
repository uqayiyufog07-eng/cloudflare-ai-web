import * as v from "valibot";
import { appendMessage, getConversationDb } from "@/lib/conversation-db";
import { parseJsonRequest } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

const STORAGE_UNCONFIGURED = "Conversation storage is not configured for this deployment.";

const appendSchema = v.object({
  message: v.object({
    id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
    role: v.picklist(["user", "assistant"]),
    parts: v.pipe(v.array(v.unknown()), v.minLength(1)),
  }),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  const parsed = await parseJsonRequest(request, appendSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const db = await getConversationDb();
  if (!db) {
    return new Response(STORAGE_UNCONFIGURED, { status: 503 });
  }

  let result: Awaited<ReturnType<typeof appendMessage>>;
  try {
    result = await appendMessage(db, id, parsed.data.message);
  } catch {
    return Response.json({ error: "Failed to access conversation storage." }, { status: 500 });
  }
  if (result === "session-not-found") {
    return new Response("Conversation not found.", { status: 404 });
  }

  return new Response(null, { status: 201 });
}
