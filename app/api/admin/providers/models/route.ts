import * as v from "valibot";
import { requireAdmin } from "@/lib/auth";
import { fetchUpstreamModelIds } from "@/lib/provider-models";
import { getProviderSettings, type ProviderSettings } from "@/lib/provider-settings";
import { parseJsonRequest } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;

const httpUrl = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1),
  v.maxLength(512),
  v.check((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be a valid http(s) URL"),
);

const probeSchema = v.object({
  provider: v.picklist(["openai", "google"]),
  apiKey: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512))),
  baseUrl: v.optional(httpUrl),
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseJsonRequest(request, probeSchema, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { provider, apiKey, baseUrl } = parsed.data;
  const stored = await getProviderSettings(provider);
  const effectiveApiKey = apiKey ?? stored?.apiKey;
  if (!effectiveApiKey) {
    return new Response("An API key is required (enter one or save the provider first).", {
      status: 400,
    });
  }

  const effectiveBaseUrl = baseUrl ?? stored?.baseUrl;
  const settings: ProviderSettings = {
    apiKey: effectiveApiKey,
    ...(effectiveBaseUrl ? { baseUrl: effectiveBaseUrl } : {}),
  };

  try {
    const models = await fetchUpstreamModelIds(provider, settings);
    return Response.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return new Response(`Failed to fetch models from the endpoint: ${message}`, { status: 502 });
  }
}
