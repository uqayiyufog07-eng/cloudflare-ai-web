import {
  deleteConversation,
  getConversationDb,
  getSession,
  loadMessages,
} from "@/lib/conversation-db";

export const dynamic = "force-dynamic";

const STORAGE_UNCONFIGURED = "Conversation storage is not configured for this deployment.";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  const db = await getConversationDb();
  if (!db) {
    return new Response(STORAGE_UNCONFIGURED, { status: 503 });
  }

  try {
    const session = await getSession(db, id);
    if (!session) {
      return new Response("Conversation not found.", { status: 404 });
    }

    return Response.json({ session, messages: await loadMessages(db, id) });
  } catch {
    return Response.json({ error: "Failed to access conversation storage." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  const db = await getConversationDb();
  if (!db) {
    return new Response(STORAGE_UNCONFIGURED, { status: 503 });
  }

  // Idempotent: deleting an unknown id is a no-op success.
  try {
    await deleteConversation(db, id);
  } catch {
    return Response.json({ error: "Failed to access conversation storage." }, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
