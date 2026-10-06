import { deleteApiKey } from "@/lib/api-keys";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const { id } = await params;
  const deleted = await deleteApiKey(id);
  if (!deleted) {
    return new Response("API key storage is not configured for this deployment.", { status: 503 });
  }

  return new Response(null, { status: 204 });
}
