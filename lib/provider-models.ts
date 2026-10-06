/**
 * Model catalog entries for admin-configured upstream providers.
 *
 * Settings with a non-empty `models` list resolve directly from the stored
 * ids. Otherwise models are fetched from the upstream endpoint (the
 * OpenAI-compatible /models list or the Google models list) with a one hour
 * in-memory cache. Failures degrade to an empty list so the rest of the
 * catalog keeps working.
 */

import type { Model } from "@/lib/models";
import type { ProviderId, ProviderSettings } from "@/lib/provider-settings";

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

export const DEFAULT_BASE_URLS: Record<ProviderId, string> = {
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

/** Model id markers for endpoints that never serve chat completions. */
const NON_CHAT_MARKERS = ["embedding", "whisper", "tts", "dall-e", "moderation"];

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
  provider: ProviderId,
  settings: ProviderSettings,
): Promise<string[]> => {
  const baseUrl = settings.baseUrl ?? DEFAULT_BASE_URLS[provider];
  const url = buildModelsUrl(baseUrl);

  if (provider === "openai") {
    const body = (await fetchJson(url, { authorization: `Bearer ${settings.apiKey}` })) as {
      data?: Array<{ id?: unknown }>;
    };
    const ids = Array.isArray(body?.data)
      ? body.data
          .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
          .filter(Boolean)
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

const toModel = (provider: ProviderId, id: string): Model =>
  provider === "openai"
    ? {
        id,
        name: id,
        brand: "OpenAI",
        type: "Text Generation",
        provider: "openai",
        source: "external",
      }
    : {
        id,
        name: id,
        brand: "Google",
        type: "Text Generation",
        provider: "google",
        source: "external",
        input: ["image", "search"],
      };

interface CacheEntry {
  sourceKey: string;
  models: Model[];
  fetchedAt: number;
}

const globalCache = globalThis as typeof globalThis & {
  upstreamModelCache?: Map<ProviderId, CacheEntry>;
};
const modelCache = globalCache.upstreamModelCache ?? new Map<ProviderId, CacheEntry>();
globalCache.upstreamModelCache = modelCache;

const sourceKey = (settings: ProviderSettings) => `${settings.baseUrl ?? ""}|${settings.apiKey}`;

/**
 * Resolves catalog models for a configured provider. Stored `models` win;
 * otherwise the upstream list is fetched and cached for one hour per
 * provider (invalidated when the key or base URL changes).
 */
export const getUpstreamModels = async (
  provider: ProviderId,
  settings: ProviderSettings,
): Promise<Model[]> => {
  if (settings.models && settings.models.length > 0) {
    return settings.models.map((id) => toModel(provider, id));
  }

  const key = sourceKey(settings);
  const entry = modelCache.get(provider);
  if (entry && entry.sourceKey === key && Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.models;
  }

  try {
    const ids = await fetchUpstreamModelIds(provider, settings);
    const models = ids.map((id) => toModel(provider, id));
    modelCache.set(provider, { sourceKey: key, models, fetchedAt: Date.now() });
    return models;
  } catch {
    // Degrade to stale models when possible, otherwise to an empty list.
    return entry && entry.sourceKey === key ? entry.models : [];
  }
};
