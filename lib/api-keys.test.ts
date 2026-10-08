import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createApiKey,
  deleteApiKey,
  findApiKeyByToken,
  generateApiToken,
  listApiKeys,
  touchApiKey,
  type ApiKeyRecord,
} from "@/lib/api-keys";

class FakeKv {
  store = new Map<string, { value: string; metadata: unknown }>();

  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { metadata?: unknown }) {
    this.store.set(key, { value, metadata: options?.metadata });
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string }) {
    const prefix = options?.prefix ?? "";
    const names = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort();
    return {
      keys: names.map((name) => ({ name, metadata: this.store.get(name)?.metadata })),
      list_complete: true,
    };
  }
}

let fakeKv: FakeKv;
let waitUntilCalls: Promise<unknown>[];

const contextRef: {
  env: Record<string, unknown>;
  ctx: { waitUntil: (promise: Promise<unknown>) => void };
} = {
  env: {},
  ctx: {
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilCalls.push(promise);
    },
  },
};

mock.module("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => {
    if (contextRef.env === null) {
      throw new Error("No Cloudflare context");
    }
    return { env: contextRef.env, ctx: contextRef.ctx, cf: undefined };
  },
}));

beforeEach(() => {
  fakeKv = new FakeKv();
  waitUntilCalls = [];
  contextRef.env = { API_KEYS: fakeKv };
});

describe("generateApiToken", () => {
  test("produces unique keys in the expected format", () => {
    const token = generateApiToken();
    expect(token).toMatch(/^sk-cfw-[0-9a-f]{48}$/);
    expect(token).not.toBe(generateApiToken());
  });
});

describe("with a KV namespace", () => {
  test("createApiKey stores and returns the entry", async () => {
    const entry = await createApiKey("local dev");

    expect(entry?.name).toBe("local dev");
    expect(entry?.token).toMatch(/^sk-cfw-[0-9a-f]{48}$/);
    expect(entry?.lastUsedAt).toBeNull();

    const record = await findApiKeyByToken(entry?.token);
    expect(record?.name).toBe("local dev");
    expect(record?.createdAt).toBe(entry?.createdAt);
  });

  test("findApiKeyByToken returns null for a miss and rejects malformed values", async () => {
    expect(await findApiKeyByToken("sk-cfw-nope")).toBeNull();
    expect(await findApiKeyByToken(undefined)).toBeNull();

    await fakeKv.put("key:sk-cfw-broken", "not-json", { metadata: { name: "x" } });
    expect(await findApiKeyByToken("sk-cfw-broken")).toBeNull();
  });

  test("listApiKeys returns entries newest first", async () => {
    const older: ApiKeyRecord = {
      name: "older",
      createdAt: "2026-01-01T00:00:00Z",
      lastUsedAt: null,
    };
    const newer: ApiKeyRecord = {
      name: "newer",
      createdAt: "2027-01-01T00:00:00Z",
      lastUsedAt: "2027-01-02T00:00:00Z",
    };
    await fakeKv.put("key:sk-cfw-older", JSON.stringify(older), { metadata: older });
    await fakeKv.put("key:sk-cfw-newer", JSON.stringify(newer), { metadata: newer });

    const keys = await listApiKeys();
    expect(keys?.map((key) => key.name)).toEqual(["newer", "older"]);
    expect(keys?.[0]).toEqual({ token: "sk-cfw-newer", ...newer });
  });

  test("deleteApiKey is idempotent", async () => {
    const entry = await createApiKey("to-delete");

    expect(await deleteApiKey(entry?.token as string)).toBe(true);
    expect(await findApiKeyByToken(entry?.token)).toBeNull();

    expect(await deleteApiKey(entry?.token as string)).toBe(true);
  });

  test("touchApiKey writes lastUsedAt through waitUntil and throttles repeats", async () => {
    const token = "sk-cfw-throttled";
    const fresh: ApiKeyRecord = { name: "k", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null };
    await fakeKv.put(`key:${token}`, JSON.stringify(fresh), { metadata: fresh });

    await touchApiKey(token, fresh);
    expect(waitUntilCalls.length).toBe(1);
    await Promise.all(waitUntilCalls);

    const updated = await findApiKeyByToken(token);
    expect(updated?.lastUsedAt).not.toBeNull();

    // A call within the throttle window must not schedule another write.
    waitUntilCalls = [];
    await touchApiKey(token, updated as ApiKeyRecord);
    expect(waitUntilCalls.length).toBe(0);
  });
});

describe("without a KV namespace", () => {
  beforeEach(() => {
    contextRef.env = {};
  });

  test("all operations degrade gracefully", async () => {
    expect(await findApiKeyByToken("sk-cfw-any")).toBeUndefined();
    expect(await findApiKeyByToken(undefined)).toBeUndefined();
    expect(await listApiKeys()).toBeUndefined();
    expect(await createApiKey("x")).toBeUndefined();
    expect(await deleteApiKey("sk-cfw-any")).toBe(false);
  });

  test("touchApiKey does nothing", async () => {
    await touchApiKey("sk-cfw-any", {
      name: "k",
      createdAt: "2026-01-01T00:00:00Z",
      lastUsedAt: null,
    });
    expect(waitUntilCalls.length).toBe(0);
  });
});

test("without a Cloudflare context all operations degrade gracefully", async () => {
  const savedEnv = contextRef.env;
  contextRef.env = null as unknown as Record<string, unknown>;

  try {
    expect(await findApiKeyByToken("sk-cfw-any")).toBeUndefined();
    expect(await listApiKeys()).toBeUndefined();
    await touchApiKey("sk-cfw-any", {
      name: "k",
      createdAt: "2026-01-01T00:00:00Z",
      lastUsedAt: null,
    });
  } finally {
    contextRef.env = savedEnv;
  }
});
