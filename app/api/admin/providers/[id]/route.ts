import * as v from "valibot";
import { requireAdmin } from "@/lib/auth";
import {
  deleteCustomProvider,
  getCustomProvider,
  isBuiltinProvider,
  listCustomProviders,
  MAX_MODEL_ID_LENGTH,
  MAX_PROVIDER_MODELS,
  PROVIDER_ID_PATTERN,
  saveCustomProvider,
  type CustomProvider,
} from "@/lib/provider-settings";
import { parseJsonRequest } from "@/lib/request-limits";

export const dynamic = "force-dynamic";

// Model ids dominate the payload: 1000 ids x 200 chars can reach ~210 KiB.
const MAX_BODY_BYTES = 262144;
const INVALID_PROVIDER_MESSAGE =
  "Invalid provider data: name must be 1-64 chars, baseUrl must be an http(s) URL or null, " +
  "and models must be a list of at most 1000 ids (200 chars each) or null.";

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

const modelIdList = v.union([
  v.pipe(
    v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_MODEL_ID_LENGTH))),
    v.maxLength(MAX_PROVIDER_MODELS),
  ),
  v.null(),
]);

const patchProviderSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))),
  enabled: v.optional(v.boolean()),
  apiKey: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(512))),
  baseUrl: v.optional(v.union([httpUrl, v.null()])),
  models: v.optional(modelIdList),
  // Used only by the built-in Workers AI service to prune its auto-synced
  // catalog; custom providers manage their whitelist through `models`.
  hiddenModels: v.optional(modelIdList),
});

const notConfiguredResponse = () =>
  new Response("Provider settings storage is not configured for this deployment.", {
    status: 503,
  });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const { id } = await params;
  if (!PROVIDER_ID_PATTERN.test(id)) {
    return new Response("Invalid provider id.", { status: 400 });
  }

  const parsed = await parseJsonRequest(
    request,
    patchProviderSchema,
    MAX_BODY_BYTES,
    INVALID_PROVIDER_MESSAGE,
  );
  if (!parsed.ok) {
    return parsed.response;
  }

  const provider = await getCustomProvider(id);
  if (provider === undefined) {
    return notConfiguredResponse();
  }
  if (provider === null) {
    return new Response("The provider does not exist.", { status: 404 });
  }

  const data = parsed.data;

  // The built-in Workers AI service has a fixed identity and an automatically
  // synced Cloudflare catalog: only the enable switch, API token and the
  // hidden-models denylist can change.
  if (
    isBuiltinProvider(id) &&
    (data.name !== undefined || data.baseUrl !== undefined || data.models !== undefined)
  ) {
    return new Response(
      "Only the enabled flag, API key and hidden models can be changed for the built-in Cloudflare Workers AI service.",
      { status: 400 },
    );
  }

  // The hidden-models denylist belongs exclusively to the built-in service.
  if (!isBuiltinProvider(id) && data.hiddenModels !== undefined) {
    return new Response(
      "hiddenModels can only be set for the built-in Cloudflare Workers AI service.",
      { status: 400 },
    );
  }

  if (data.name) {
    const all = await listCustomProviders();
    if (!all) {
      return notConfiguredResponse();
    }
    const conflict = all.some(
      (entry) => entry.id !== id && entry.name.toLowerCase() === data.name!.toLowerCase(),
    );
    if (conflict) {
      return new Response("A provider with this name already exists.", { status: 409 });
    }
  }

  const updated: CustomProvider = { ...provider };
  if (data.name) {
    updated.name = data.name;
  }
  if (data.enabled !== undefined) {
    updated.enabled = data.enabled;
  }
  if (data.apiKey) {
    updated.apiKey = data.apiKey;
  }
  if (data.baseUrl !== undefined) {
    if (data.baseUrl === null) {
      delete updated.baseUrl;
    } else {
      updated.baseUrl = data.baseUrl;
    }
  }
  if (data.models !== undefined) {
    const deduped = data.models === null ? [] : [...new Set(data.models)];
    if (deduped.length === 0) {
      delete updated.models;
    } else {
      updated.models = deduped;
    }
  }
  if (data.hiddenModels !== undefined) {
    const deduped = data.hiddenModels === null ? [] : [...new Set(data.hiddenModels)];
    if (deduped.length === 0) {
      delete updated.hiddenModels;
    } else {
      updated.hiddenModels = deduped;
    }
  }

  const saved = await saveCustomProvider(updated);
  if (!saved) {
    return notConfiguredResponse();
  }

  return Response.json({ provider: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const { id } = await params;
  if (!PROVIDER_ID_PATTERN.test(id)) {
    return new Response("Invalid provider id.", { status: 400 });
  }

  if (isBuiltinProvider(id)) {
    return new Response(
      "The built-in Cloudflare Workers AI service cannot be deleted. Disable it instead.",
      { status: 400 },
    );
  }

  const removed = await deleteCustomProvider(id);
  if (!removed) {
    return notConfiguredResponse();
  }

  return new Response(null, { status: 204 });
}
