import * as v from "valibot";
import { requireAdmin } from "@/lib/auth";
import { fetchUpstreamModelIds } from "@/lib/provider-models";
import {
  getCustomProvider,
  PROVIDER_ID_PATTERN,
  type ProviderStyle,
} from "@/lib/provider-settings";
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
  // Stored provider id; when omitted the probe uses style + the submitted
  // credentials (used while adding a provider before it is saved).
  id: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
  style: v.optional(v.picklist(["openai", "gemini"])),
  apiKey: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512))),
  baseUrl: v.optional(httpUrl),
});

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseJsonRequest(
    request,
    probeSchema,
    MAX_BODY_BYTES,
    "Invalid request: expected an optional provider id, style, apiKey and an http(s) baseUrl.",
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  const { id, apiKey, baseUrl } = parsed.data;
  let style: ProviderStyle | undefined = parsed.data.style;
  let storedApiKey: string | undefined;
  let storedBaseUrl: string | undefined;

  if (id) {
    if (!PROVIDER_ID_PATTERN.test(id)) {
      return new Response("Invalid provider id.", { status: 400 });
    }
    const stored = await getCustomProvider(id);
    if (stored === undefined) {
      return new Response("Provider settings storage is not configured for this deployment.", {
        status: 503,
      });
    }
    if (stored === null) {
      return new Response("The provider does not exist.", { status: 404 });
    }
    style = stored.style;
    storedApiKey = stored.apiKey;
    storedBaseUrl = stored.baseUrl;
  }

  if (!style) {
    return new Response("An integration style (openai or gemini) is required.", { status: 400 });
  }

  const effectiveApiKey = apiKey ?? storedApiKey;
  if (!effectiveApiKey) {
    return new Response("An API key is required (enter one or save the provider first).", {
      status: 400,
    });
  }

  const effectiveBaseUrl = baseUrl ?? storedBaseUrl;

  try {
    const models = await fetchUpstreamModelIds(style, {
      apiKey: effectiveApiKey,
      ...(effectiveBaseUrl ? { baseUrl: effectiveBaseUrl } : {}),
    });
    return Response.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return new Response(`Failed to fetch models from the endpoint: ${message}`, { status: 502 });
  }
}
