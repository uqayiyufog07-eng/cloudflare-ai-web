import * as v from "valibot";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { requireAdmin } from "@/lib/auth";
import { parseJsonRequest } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;

const createSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
});

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const keys = await listApiKeys();
  if (!keys) {
    return new Response("API key storage is not configured for this deployment.", { status: 503 });
  }

  return Response.json({ keys });
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseJsonRequest(request, createSchema, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.response;
  }

  const entry = await createApiKey(parsed.data.name);
  if (!entry) {
    return new Response("API key storage is not configured for this deployment.", { status: 503 });
  }

  return Response.json(entry, { status: 201 });
}
