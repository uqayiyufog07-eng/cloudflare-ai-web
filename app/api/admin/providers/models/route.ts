import * as v from "valibot";
import { requireAdmin } from "@/lib/auth";
import { listWorkersAiCatalogModels, probeWorkersAiCredentials } from "@/lib/model-catalog";
import { fetchUpstreamModelIds } from "@/lib/provider-models";
import { ProviderConfigurationError } from "@/lib/providers";
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
  style: v.optional(v.picklist(["openai", "gemini", "workers-ai"])),
  apiKey: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512))),
  baseUrl: v.optional(httpUrl),
});

/**
 * Returns the full Cloudflare Workers AI catalog (chat + image) for the
 * built-in service's model manager. The hidden-models denylist is not applied
 * here so the admin UI can show both visible and removed models; credentials
 * follow the same KV-token-first, deployment-secret-fallback resolution.
 */
export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  try {
    const models = await listWorkersAiCatalogModels();
    return Response.json({
      models: models.map((model) => ({ id: model.id, type: model.type })),
    });
  } catch (error) {
    if (error instanceof ProviderConfigurationError) {
      const status = error.message.includes("CF_ACCOUNT_ID") ? 503 : 400;
      return new Response(error.message, { status });
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return new Response(`Failed to load the Workers AI catalog: ${message}`, { status: 502 });
  }
}

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

  if (style === "workers-ai") {
    const accountId = process.env.CF_ACCOUNT_ID;
    if (!accountId) {
      return new Response("Missing CF_ACCOUNT_ID for this deployment.", { status: 503 });
    }

    const token = apiKey || storedApiKey || process.env.CF_WORKERS_AI_TOKEN;
    if (!token) {
      return new Response(
        "A Workers AI API token is required (enter one or set the CF_WORKERS_AI_TOKEN secret).",
        { status: 400 },
      );
    }

    try {
      // The Workers AI catalog is synced independently; the probe only proves
      // the credentials work, so no model ids are returned.
      await probeWorkersAiCredentials(accountId, token);
      return Response.json({ models: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return new Response(`Failed to validate Workers AI credentials: ${message}`, {
        status: 502,
      });
    }
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
