import * as v from "valibot";
import { requireAdmin } from "@/lib/auth";
import {
  generateProviderId,
  listCustomProviders,
  PROVIDER_ID_PATTERN,
  RESERVED_PROVIDER_IDS,
  saveCustomProvider,
  type CustomProvider,
  type ProviderStyle,
} from "@/lib/provider-settings";
import { parseJsonRequest } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

// Model ids dominate the payload: 200 ids x 128 chars can reach ~26 KiB.
const MAX_BODY_BYTES = 65536;
const MAX_MODELS = 200;

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

const createProviderSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64)),
  style: v.picklist(["openai", "gemini"]),
  apiKey: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512))),
  baseUrl: v.optional(httpUrl),
  enabled: v.optional(v.boolean()),
  models: v.optional(
    v.pipe(
      v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(128))),
      v.maxLength(MAX_MODELS),
    ),
  ),
});

const notConfiguredResponse = () =>
  new Response("Provider settings storage is not configured for this deployment.", {
    status: 503,
  });

const normalizeModels = (models?: string[]) => {
  if (!models) {
    return undefined;
  }
  const deduped = [...new Set(models)];
  return deduped.length > 0 ? deduped : undefined;
};

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const providers = await listCustomProviders();
  if (!providers) {
    return notConfiguredResponse();
  }

  return Response.json({ providers });
}

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseJsonRequest(request, createProviderSchema, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.response;
  }

  const existing = await listCustomProviders();
  if (!existing) {
    return notConfiguredResponse();
  }

  if (existing.some((provider) => provider.name.toLowerCase() === parsed.data.name.toLowerCase())) {
    return new Response("A provider with this name already exists.", { status: 409 });
  }

  const id = generateProviderId(
    parsed.data.name,
    existing.map((provider) => provider.id),
  );
  if (!PROVIDER_ID_PATTERN.test(id) || RESERVED_PROVIDER_IDS.includes(id)) {
    return new Response("Invalid provider id.", { status: 400 });
  }

  const provider: CustomProvider = {
    id,
    name: parsed.data.name,
    style: parsed.data.style as ProviderStyle,
    enabled: parsed.data.enabled ?? true,
    apiKey: parsed.data.apiKey ?? "",
    ...(parsed.data.baseUrl ? { baseUrl: parsed.data.baseUrl } : {}),
    ...(normalizeModels(parsed.data.models)
      ? { models: normalizeModels(parsed.data.models) }
      : {}),
    createdAt: new Date().toISOString(),
  };

  const saved = await saveCustomProvider(provider);
  if (!saved) {
    return notConfiguredResponse();
  }

  return Response.json({ provider }, { status: 201 });
}
