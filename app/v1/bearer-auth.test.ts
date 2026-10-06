import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { GET as getModels } from "@/app/v1/models/route";

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
    return { keys: names.map((name) => ({ name })), list_complete: true };
  }
}

let fakeKv: FakeKv;
const contextRef: { env: Record<string, unknown> | null; ctx: { waitUntil: () => void } } = {
  env: {},
  ctx: { waitUntil: () => {} },
};

mock.module("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => {
    if (contextRef.env === null) {
      throw new Error("No Cloudflare context");
    }
    return { env: contextRef.env, ctx: contextRef.ctx, cf: undefined };
  },
}));

const modelsRequest = (token?: string) =>
  new Request("https://example.com/v1/models", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });

const withEnvKey = async (envKey: string | undefined, run: () => Promise<void>) => {
  const original = process.env.OPENAI_API_KEY;
  // Assigning undefined to process.env stores the string "undefined"; always delete.
  if (envKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = envKey;
  }
  try {
    await run();
  } finally {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = original;
    }
  }
};

beforeEach(() => {
  fakeKv = new FakeKv();
  contextRef.env = { API_KEYS: fakeKv };
});

afterEach(() => {
  // Neutralize the mocked context so later test files degrade gracefully.
  contextRef.env = null;
});

test("a KV key authorizes the request", async () => {
  const record = { name: "k", createdAt: new Date().toISOString(), lastUsedAt: null };
  const token = "sk-cfw-kvkey";
  await fakeKv.put(`key:${token}`, JSON.stringify(record), { metadata: record });

  await withEnvKey(undefined, async () => {
    const response = await getModels(modelsRequest(token));
    expect(response.status).toBe(200);
  });
});

test("an unknown token is rejected with 401 when a KV store exists", async () => {
  await withEnvKey(undefined, async () => {
    const response = await getModels(modelsRequest("sk-cfw-unknown"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("invalid_api_key");
  });
});

test("the environment key still works alongside the KV store", async () => {
  await withEnvKey("env-key", async () => {
    const response = await getModels(modelsRequest("env-key"));
    expect(response.status).toBe(200);

    const rejected = await getModels(modelsRequest("sk-cfw-unknown"));
    expect(rejected.status).toBe(401);
  });
});

test("a missing Bearer header is rejected when a KV store exists", async () => {
  await withEnvKey(undefined, async () => {
    const response = await getModels(modelsRequest());
    expect(response.status).toBe(401);
  });
});

test("without a KV store the environment key is required", async () => {
  contextRef.env = {};
  try {
    await withEnvKey("env-key", async () => {
      const response = await getModels(modelsRequest("env-key"));
      expect(response.status).toBe(200);

      const rejected = await getModels(modelsRequest("nope"));
      expect(rejected.status).toBe(401);
    });
  } finally {
    contextRef.env = { API_KEYS: fakeKv };
  }
});

test("without a KV store or environment key the deployment is public", async () => {
  contextRef.env = {};
  try {
    await withEnvKey(undefined, async () => {
      const response = await getModels(modelsRequest());
      expect(response.status).toBe(200);
    });
  } finally {
    contextRef.env = { API_KEYS: fakeKv };
  }
});
