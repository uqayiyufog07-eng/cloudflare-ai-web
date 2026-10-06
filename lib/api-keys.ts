/**
 * Dynamic API key store for the OpenAI-compatible /v1 endpoints.
 *
 * Keys live in the API_KEYS KV namespace (see wrangler.jsonc) under `key:<token>`.
 * Every access degrades gracefully when the binding is absent (e.g. `next dev`
 * without initOpenNextCloudflareForDev, or a deployment that never added the
 * namespace): read APIs return undefined, matches return null, and writes fail
 * silently so callers can fall back to the static environment key.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface ApiKeyRecord {
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiKeyEntry {
  token: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const KEY_PREFIX = "key:";
const LAST_USED_THROTTLE_MS = 60_000;

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

const getApiKeysNamespace = async (): Promise<KvNamespace | undefined> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return (env as { API_KEYS?: KvNamespace }).API_KEYS;
  } catch {
    // No Cloudflare request context (local dev, tests, build-time).
    return undefined;
  }
};

const buildKey = (token: string) => `${KEY_PREFIX}${token}`;

const toRecord = (metadata: unknown): ApiKeyRecord | null => {
  if (typeof metadata !== "object" || metadata === null) {
    return null;
  }
  const { name, createdAt, lastUsedAt } = metadata as Partial<ApiKeyRecord>;
  if (typeof name !== "string" || typeof createdAt !== "string") {
    return null;
  }
  return {
    name,
    createdAt,
    lastUsedAt: typeof lastUsedAt === "string" ? lastUsedAt : null,
  };
};

/** Generates a new random API key: `sk-cfw-<48 hex chars>`. */
export const generateApiToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sk-cfw-${hex}`;
};

/**
 * Looks up the record for a bearer token.
 * Returns the record on hit, null on miss, and undefined when no KV store is
 * configured (callers must treat that as "dynamic keys disabled").
 */
export const findApiKeyByToken = async (
  token: string | undefined,
): Promise<ApiKeyRecord | null | undefined> => {
  const namespace = await getApiKeysNamespace();
  if (!namespace) {
    return undefined;
  }
  if (!token) {
    return null;
  }

  const value = await namespace.get(buildKey(token));
  if (value === null) {
    return null;
  }

  try {
    return toRecord(JSON.parse(value));
  } catch {
    return null;
  }
};

/**
 * Creates a new API key. Returns undefined when no KV store is configured.
 */
export const createApiKey = async (name: string): Promise<ApiKeyEntry | undefined> => {
  const namespace = await getApiKeysNamespace();
  if (!namespace) {
    return undefined;
  }

  const record: ApiKeyRecord = {
    name,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  const token = generateApiToken();
  await namespace.put(buildKey(token), JSON.stringify(record), {
    metadata: record,
  });

  return { token, ...record };
};

/**
 * Lists all API keys, newest first. Returns undefined when no KV store is
 * configured.
 */
export const listApiKeys = async (): Promise<ApiKeyEntry[] | undefined> => {
  const namespace = await getApiKeysNamespace();
  if (!namespace) {
    return undefined;
  }

  const entries: ApiKeyEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await namespace.list({ prefix: KEY_PREFIX, cursor });
    for (const key of page.keys) {
      const record = toRecord(key.metadata);
      if (!record) {
        continue;
      }
      entries.push({ token: key.name.slice(KEY_PREFIX.length), ...record });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

/**
 * Deletes an API key by its token. Idempotent; returns whether the store is
 * configured (false when it is not).
 */
export const deleteApiKey = async (token: string): Promise<boolean> => {
  const namespace = await getApiKeysNamespace();
  if (!namespace) {
    return false;
  }

  await namespace.delete(buildKey(token));
  return true;
};

/**
 * Best-effort update of lastUsedAt for a matched token, throttled to one write
 * per minute per key. Runs via waitUntil so it never blocks the response.
 */
export const touchApiKey = async (token: string, record: ApiKeyRecord): Promise<void> => {
  try {
    const { env, ctx } = await getCloudflareContext({ async: true });
    const namespace = (env as { API_KEYS?: KvNamespace }).API_KEYS;
    if (!namespace) {
      return;
    }

    const lastUsedMs = record.lastUsedAt ? Date.parse(record.lastUsedAt) : Number.NaN;
    if (Number.isFinite(lastUsedMs) && Date.now() - lastUsedMs < LAST_USED_THROTTLE_MS) {
      return;
    }

    const updated: ApiKeyRecord = { ...record, lastUsedAt: new Date().toISOString() };
    ctx.waitUntil(
      namespace.put(buildKey(token), JSON.stringify(updated), { metadata: updated }),
    );
  } catch {
    // Best-effort telemetry; failures must not affect the request.
  }
};
