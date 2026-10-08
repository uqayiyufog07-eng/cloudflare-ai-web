/**
 * Runtime settings for user-defined upstream model providers.
 *
 * Every entry describes one third-party model platform added in the
 * /admin console (e.g. an OpenAI-compatible relay or a Gemini-compatible
 * endpoint). Entries live in the API_KEYS KV namespace (see wrangler.jsonc)
 * under `settings:provider:<id>` so credentials can be managed at runtime
 * without redeploying. When the binding is absent, reads return undefined
 * and callers fall back to the static environment variables.
 *
 * Legacy fixed-provider keys (`settings:openai`, `settings:google`) are
 * migrated lazily the first time providers are listed.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Wire protocol used to talk to an upstream platform. */
export type ProviderStyle = "openai" | "gemini";

export interface CustomProvider {
  id: string;
  name: string;
  style: ProviderStyle;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  createdAt: string;
}

/** Shape of the pre-multi-provider storage. Only used while migrating. */
export interface LegacyProviderSettings {
  apiKey: string;
  baseUrl?: string;
  models?: string[];
}

const PROVIDER_PREFIX = "settings:provider:";
const LEGACY_KEYS: Array<{ id: string; style: ProviderStyle; name: string }> = [
  { id: "openai", style: "openai", name: "OpenAI" },
  { id: "google", style: "gemini", name: "Google" },
];

export const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;
export const RESERVED_PROVIDER_IDS = ["workers-ai"];

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

const buildKey = (id: string) => `${PROVIDER_PREFIX}${id}`;

const toStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ids = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  return ids.length > 0 ? ids : undefined;
};

const toProvider = (value: string): CustomProvider | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Partial<CustomProvider>;
    if (
      typeof record.id !== "string" ||
      !PROVIDER_ID_PATTERN.test(record.id) ||
      typeof record.name !== "string" ||
      record.name.trim().length === 0 ||
      (record.style !== "openai" && record.style !== "gemini") ||
      typeof record.apiKey !== "string"
    ) {
      return null;
    }

    return {
      id: record.id,
      name: record.name.trim(),
      style: record.style,
      enabled: record.enabled !== false,
      apiKey: record.apiKey,
      ...(typeof record.baseUrl === "string" && record.baseUrl.trim().length > 0
        ? { baseUrl: record.baseUrl.trim() }
        : {}),
      ...(toStringArray(record.models) ? { models: toStringArray(record.models) } : {}),
      ...(typeof record.createdAt === "string" && record.createdAt
        ? { createdAt: record.createdAt }
        : { createdAt: "" }),
    };
  } catch {
    return null;
  }
};

const toLegacySettings = (value: string): LegacyProviderSettings | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const { apiKey, baseUrl, models } = parsed as Partial<LegacyProviderSettings>;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return null;
    }
    return {
      apiKey,
      ...(typeof baseUrl === "string" && baseUrl.length > 0 ? { baseUrl } : {}),
      ...(toStringArray(models) ? { models: toStringArray(models) } : {}),
    };
  } catch {
    return null;
  }
};

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");

/** Builds a unique provider id from its display name. */
export const generateProviderId = (name: string, takenIds: Iterable<string>): string => {
  const taken = new Set(takenIds);
  const base = slugify(name) || "provider";
  if (!taken.has(base)) {
    return base;
  }
  for (let i = 0; i < 10; i++) {
    const suffix = crypto.randomUUID().slice(0, 4);
    const id = `${base}-${suffix}`;
    if (!taken.has(id)) {
      return id;
    }
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
};

/** Moves pre-multi-provider `settings:<id>` keys to the new key layout once. */
const migrateLegacyProviders = async (namespace: KvNamespace): Promise<void> => {
  for (const legacy of LEGACY_KEYS) {
    const legacyKey = `settings:${legacy.id}`;
    const value = await namespace.get(legacyKey);
    if (value === null) {
      continue;
    }
    const settings = toLegacySettings(value);
    if (!settings) {
      // Malformed legacy entries are dropped.
      await namespace.delete(legacyKey);
      continue;
    }
    const provider: CustomProvider = {
      id: legacy.id,
      name: legacy.name,
      style: legacy.style,
      enabled: true,
      apiKey: settings.apiKey,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      ...(settings.models ? { models: settings.models } : {}),
      createdAt: new Date().toISOString(),
    };
    await namespace.put(buildKey(legacy.id), JSON.stringify(provider));
    await namespace.delete(legacyKey);
  }
};

/**
 * Lists every stored provider. Returns undefined when no KV store is
 * configured (callers fall back to environment variables).
 */
export const listCustomProviders = async (): Promise<CustomProvider[] | undefined> => {
  const namespace = await getNamespace();
  if (!namespace) {
    return undefined;
  }

  await migrateLegacyProviders(namespace);

  const providers: CustomProvider[] = [];
  let cursor: string | undefined;
  do {
    const page = await namespace.list({ prefix: PROVIDER_PREFIX, cursor });
    for (const entry of page.keys) {
      const value = await namespace.get(entry.name);
      if (value === null) {
        continue;
      }
      const provider = toProvider(value);
      if (provider) {
        providers.push(provider);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return providers.sort((a, b) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.name.localeCompare(b.name),
  );
};

/**
 * Reads one stored provider. Returns null when missing and undefined when no
 * KV store is configured.
 */
export const getCustomProvider = async (
  id: string,
): Promise<CustomProvider | null | undefined> => {
  const namespace = await getNamespace();
  if (!namespace) {
    return undefined;
  }

  const value = await namespace.get(buildKey(id));
  if (value === null) {
    return null;
  }
  return toProvider(value);
};

/** Saves (upserts) a provider. Returns false when no KV store is configured. */
export const saveCustomProvider = async (provider: CustomProvider): Promise<boolean> => {
  const namespace = await getNamespace();
  if (!namespace) {
    return false;
  }

  await namespace.put(buildKey(provider.id), JSON.stringify(provider));
  return true;
};

/** Deletes a provider. Idempotent; returns whether a store is configured. */
export const deleteCustomProvider = async (id: string): Promise<boolean> => {
  const namespace = await getNamespace();
  if (!namespace) {
    return false;
  }

  await namespace.delete(buildKey(id));
  return true;
};
