/**
 * Runtime provider settings for upstream chat providers (OpenAI-compatible
 * endpoints and the Google Gemini API).
 *
 * Settings live in the API_KEYS KV namespace (see wrangler.jsonc) under
 * `settings:<provider>` so the admin console can manage credentials without
 * redeploying. The same degradation rules as lib/api-keys apply: when the
 * binding is absent reads return undefined and callers fall back to the
 * static environment variables.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export type ProviderId = "openai" | "google";

export interface ProviderSettings {
  apiKey: string;
  baseUrl?: string;
  models?: string[];
}

const SETTINGS_PREFIX = "settings:";

/** Minimal structural type for the Workers KV namespace binding. */
interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

const getNamespace = async (): Promise<KvNamespace | undefined> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as { API_KEYS?: KvNamespace }).API_KEYS;
  } catch {
    // No Cloudflare request context (local dev, tests, build-time).
    return undefined;
  }
};

const buildKey = (provider: ProviderId) => `${SETTINGS_PREFIX}${provider}`;

const toSettings = (value: string): ProviderSettings | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const { apiKey, baseUrl, models } = parsed as Partial<ProviderSettings>;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return null;
    }

    return {
      apiKey,
      ...(typeof baseUrl === "string" && baseUrl.length > 0 ? { baseUrl } : {}),
      ...(Array.isArray(models)
        ? {
            models: models.filter((id): id is string => typeof id === "string" && id.length > 0),
          }
        : {}),
    };
  } catch {
    return null;
  }
};

/**
 * Reads the stored settings for a provider.
 * Returns null when nothing valid is stored, and undefined when no KV store is
 * configured (callers fall back to environment variables).
 */
export const getProviderSettings = async (
  provider: ProviderId,
): Promise<ProviderSettings | null | undefined> => {
  const namespace = await getNamespace();
  if (!namespace) {
    return undefined;
  }

  const value = await namespace.get(buildKey(provider));
  if (value === null) {
    return null;
  }

  return toSettings(value);
};

/**
 * Returns the settings of every configured provider, or undefined when no KV
 * store is configured at all.
 */
export const getEnabledProviders = async (): Promise<
  Partial<Record<ProviderId, ProviderSettings>> | undefined
> => {
  const openai = await getProviderSettings("openai");
  const google = await getProviderSettings("google");
  if (openai === undefined && google === undefined) {
    return undefined;
  }

  return {
    ...(openai ? { openai } : {}),
    ...(google ? { google } : {}),
  };
};

/** Saves provider settings. Returns false when no KV store is configured. */
export const saveProviderSettings = async (
  provider: ProviderId,
  settings: ProviderSettings,
): Promise<boolean> => {
  const namespace = await getNamespace();
  if (!namespace) {
    return false;
  }

  await namespace.put(buildKey(provider), JSON.stringify(settings));
  return true;
};

/** Deletes provider settings. Idempotent; returns whether a store is configured. */
export const deleteProviderSettings = async (provider: ProviderId): Promise<boolean> => {
  const namespace = await getNamespace();
  if (!namespace) {
    return false;
  }

  await namespace.delete(buildKey(provider));
  return true;
};
