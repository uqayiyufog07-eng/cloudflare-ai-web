import * as v from "valibot";
import { requireAdmin } from "@/lib/auth";
import {
  deleteProviderSettings,
  getEnabledProviders,
  saveProviderSettings,
  type ProviderId,
  type ProviderSettings,
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

const providerSettingsSchema = v.object({
  apiKey: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512)),
  baseUrl: v.optional(httpUrl),
  models: v.optional(
    v.pipe(
      v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(128))),
      v.maxLength(MAX_MODELS),
    ),
  ),
});

const putSchema = v.object({
  openai: v.optional(v.union([providerSettingsSchema, v.null()])),
  google: v.optional(v.union([providerSettingsSchema, v.null()])),
});

const normalizeSettings = (
  input: v.InferOutput<typeof providerSettingsSchema>,
): ProviderSettings => {
  const models = input.models ? [...new Set(input.models)] : undefined;
  return {
    apiKey: input.apiKey,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(models && models.length > 0 ? { models } : {}),
  };
};

const notConfiguredResponse = () =>
  new Response("Provider settings storage is not configured for this deployment.", {
    status: 503,
  });

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const providers = await getEnabledProviders();
  if (!providers) {
    return notConfiguredResponse();
  }

  return Response.json({ providers });
}

export async function PUT(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseJsonRequest(request, putSchema, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.response;
  }

  const updates: Array<[ProviderId, ProviderSettings | null]> = [];
  if (parsed.data.openai !== undefined) {
    updates.push(["openai", parsed.data.openai]);
  }
  if (parsed.data.google !== undefined) {
    updates.push(["google", parsed.data.google]);
  }

  for (const [provider, settings] of updates) {
    const saved =
      settings === null
        ? await deleteProviderSettings(provider)
        : await saveProviderSettings(provider, normalizeSettings(settings));
    if (!saved) {
      return notConfiguredResponse();
    }
  }

  const providers = await getEnabledProviders();
  return Response.json({ providers });
}
