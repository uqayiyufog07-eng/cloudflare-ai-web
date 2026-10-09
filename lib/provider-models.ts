/**
 * Model catalog entries for admin-configured upstream providers.
 *
 * Providers with a non-empty `models` list resolve directly from the stored
 * ids. Otherwise models are fetched from the upstream endpoint (the
 * OpenAI-compatible /models list or the Gemini models list) with a one hour
 * in-memory cache. Failures degrade to an empty list so the rest of the
 * catalog keeps working.
 */

import type { Model } from "@/lib/models";
import { getDisplayBrand } from "@/lib/models";
import type { CustomProvider, ProviderStyle } from "@/lib/provider-settings";

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

/** Integration styles served by a remote /models endpoint (Workers AI syncs its own catalog). */
export type UpstreamProviderStyle = Exclude<ProviderStyle, "workers-ai">;

export const DEFAULT_BASE_URLS: Record<UpstreamProviderStyle, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

/** Model id markers for endpoints that never serve chat completions. */
const NON_CHAT_MARKERS = [
  "embedding",
  "whisper",
  "tts",
  "dall-e",
  "gpt-image",
  "seedream",
  "moderation",
];

const buildModelsUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/models`;

const isChatModelId = (id: string) =>
  !NON_CHAT_MARKERS.some((marker) => id.toLowerCase().includes(marker));

const fetchJson = async (url: string, headers: Record<string, string>) => {
  const response = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`the endpoint returned ${response.status}`);
  }
  return (await response.json()) as unknown;
};

/**
 * One-shot fetch of model ids from an upstream endpoint. Used by the admin
 * probe API and (with caching) by the model catalog when no explicit model
 * list is stored. Throws on upstream failures.
 */
export const fetchUpstreamModelIds = async (
  style: UpstreamProviderStyle,
  settings: { apiKey: string; baseUrl?: string },
): Promise<string[]> => {
  const baseUrl = settings.baseUrl ?? DEFAULT_BASE_URLS[style];
  const url = buildModelsUrl(baseUrl);

  if (style === "openai") {
    const body = (await fetchJson(url, { authorization: `Bearer ${settings.apiKey}` })) as {
      data?: Array<{ id?: unknown }>;
    };
    const ids = Array.isArray(body?.data)
      ? body.data.map((entry) => (typeof entry?.id === "string" ? entry.id : "")).filter(Boolean)
      : [];
    return [...new Set(ids)].filter(isChatModelId).sort();
  }

  const body = (await fetchJson(url, { "x-goog-api-key": settings.apiKey })) as {
    models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>;
  };
  const ids = Array.isArray(body?.models)
    ? body.models
        .filter(
          (entry) =>
            typeof entry?.name === "string" &&
            Array.isArray(entry.supportedGenerationMethods) &&
            entry.supportedGenerationMethods.includes("generateContent"),
        )
        .map((entry) => (entry.name as string).replace(/^models\//, ""))
    : [];
  return [...new Set(ids)].sort();
};

const toModel = (provider: CustomProvider, id: string): Model => {
  const base: Model =
    provider.style === "openai"
      ? {
          id,
          name: id,
          brand: "OpenAI",
          type: "Text Generation",
          provider: provider.id,
          providerName: provider.name,
          source: "external",
        }
      : {
          id,
          name: id,
          brand: "Google",
          type: "Text Generation",
          provider: provider.id,
          providerName: provider.name,
          source: "external",
          input: ["image", "search"],
        };

  // Models on an OpenAI-compatible endpoint can belong to any vendor
  // (Claude, DeepSeek, Qwen, ...); infer the real brand from the model id.
  return { ...base, brand: getDisplayBrand(base) };
};

interface CacheEntry {
  sourceKey: string;
  models: Model[];
  fetchedAt: number;
  refresh?: Promise<Model[]>;
}

const globalCache = globalThis as typeof globalThis & {
  upstreamModelCache?: Map<string, CacheEntry>;
};
const modelCache = globalCache.upstreamModelCache ?? new Map<string, CacheEntry>();
globalCache.upstreamModelCache = modelCache;

const sourceKey = (provider: CustomProvider) =>
  [provider.name, provider.style, provider.baseUrl ?? "", provider.apiKey, provider.enabled].join(
    "|",
  );

/**
 * Resolves catalog models for one configured provider. Disabled providers
 * resolve to nothing. Stored `models` win; otherwise the upstream list is
 * fetched and cached for one hour per provider (invalidated when the name,
 * key, base URL or enabled flag changes).
 */
export const getUpstreamModels = async (provider: CustomProvider): Promise<Model[]> => {
  if (!provider.enabled) {
    return [];
  }

  // The built-in Workers AI service syncs its catalog from Cloudflare itself.
  if (provider.style === "workers-ai") {
    return [];
  }

  if (provider.models && provider.models.length > 0) {
    return provider.models.map((id) => toModel(provider, id));
  }

  const key = sourceKey(provider);
  const entry = modelCache.get(provider.id);
  if (entry && entry.sourceKey === key && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.models;
  }

  try {
    const ids = await fetchUpstreamModelIds(provider.style, provider);
    const models = ids.map((id) => toModel(provider, id));
    modelCache.set(provider.id, { sourceKey: key, models, fetchedAt: Date.now() });
    return models;
  } catch {
    // Degrade to stale models when possible, otherwise to an empty list.
    return entry && entry.sourceKey === key ? entry.models : [];
  }
};
