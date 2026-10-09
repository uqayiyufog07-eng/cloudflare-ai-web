import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  deleteCustomProvider,
  generateProviderId,
  getCustomProvider,
  listAdminProviders,
  listCustomProviders,
  saveCustomProvider,
  WORKERS_AI_DEFAULT_PROVIDER,
  type CustomProvider,
} from "@/lib/provider-settings";

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

const contextRef: {
  env: Record<string, unknown> | null;
  ctx: { waitUntil: () => void };
} = {
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

const makeProvider = (overrides: Partial<CustomProvider> = {}): CustomProvider => ({
  id: "aimixhub",
  name: "aimixhub",
  style: "openai",
  enabled: true,
  apiKey: "sk-upstream",
  baseUrl: "https://aihubmix.com/v1",
  models: ["gpt-5.2", "claude-x"],
  createdAt: "2026-10-07T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  fakeKv = new FakeKv();
  contextRef.env = { API_KEYS: fakeKv };
});

describe("with a KV namespace", () => {
  test("saveCustomProvider stores and getCustomProvider round-trips", async () => {
    const provider = makeProvider();
    expect(await saveCustomProvider(provider)).toBe(true);

    expect(await fakeKv.get("settings:provider:aimixhub")).not.toBeNull();
    expect(await getCustomProvider("aimixhub")).toEqual(provider);
  });

  test("getCustomProvider returns null for a miss and rejects malformed values", async () => {
    expect(await getCustomProvider("missing")).toBeNull();

    await fakeKv.put("settings:provider:bad", "not-json");
    expect(await getCustomProvider("bad")).toBeNull();

    await fakeKv.put(
      "settings:provider:bad2",
      JSON.stringify({ id: "bad2", name: "x", style: "webdav", apiKey: "k" }),
    );
    expect(await getCustomProvider("bad2")).toBeNull();
  });

  test("getCustomProvider sanitizes stored values", async () => {
    await fakeKv.put(
      "settings:provider:p",
      JSON.stringify({
        id: "p",
        name: "  p  ",
        style: "openai",
        apiKey: "k",
        baseUrl: "  https://example.com/v1  ",
        models: ["valid", 42, "", null],
        enabled: false,
      }),
    );
    expect(await getCustomProvider("p")).toEqual({
      id: "p",
      name: "p",
      style: "openai",
      enabled: false,
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      models: ["valid"],
      createdAt: "",
    });
  });

  test("listCustomProviders returns stored providers sorted by creation time", async () => {
    await saveCustomProvider(makeProvider({ id: "b", name: "b", createdAt: "2026-10-07T02:00:00Z" }));
    await saveCustomProvider(makeProvider({ id: "a", name: "a", createdAt: "2026-10-07T01:00:00Z" }));

    expect((await listCustomProviders())?.map((provider) => provider.id)).toEqual(["a", "b"]);
  });

  test("listCustomProviders migrates legacy settings:openai and settings:google once", async () => {
    await fakeKv.put(
      "settings:openai",
      JSON.stringify({ apiKey: "sk-legacy", baseUrl: "https://relay.example/v1", models: ["gpt-x"] }),
    );
    await fakeKv.put("settings:google", "not-json");

    const providers = await listCustomProviders();
    expect(providers).toEqual([
      {
        id: "openai",
        name: "OpenAI",
        style: "openai",
        enabled: true,
        apiKey: "sk-legacy",
        baseUrl: "https://relay.example/v1",
        models: ["gpt-x"],
        createdAt: expect.any(String),
      },
    ]);

    // Legacy keys are gone and the second listing does not resurrect anything.
    expect(await fakeKv.get("settings:openai")).toBeNull();
    expect(await fakeKv.get("settings:google")).toBeNull();
    expect((await listCustomProviders())?.map((provider) => provider.id)).toEqual(["openai"]);
  });

  test("deleteCustomProvider is idempotent", async () => {
    await saveCustomProvider(makeProvider());
    expect(await deleteCustomProvider("aimixhub")).toBe(true);
    expect(await getCustomProvider("aimixhub")).toBeNull();
    expect(await deleteCustomProvider("aimixhub")).toBe(true);
  });

  test("the built-in Workers AI provider resolves to defaults before it is saved", async () => {
    expect(await getCustomProvider("workers-ai")).toEqual({ ...WORKERS_AI_DEFAULT_PROVIDER });
  });

  test("the built-in Workers AI provider merges stored overrides", async () => {
    await fakeKv.put(
      "settings:provider:workers-ai",
      JSON.stringify({
        id: "workers-ai",
        name: "tampered",
        style: "workers-ai",
        enabled: false,
        apiKey: "cf-token",
        baseUrl: "https://example.com/v1",
        models: ["@cf/x/y"],
      }),
    );

    expect(await getCustomProvider("workers-ai")).toEqual({
      ...WORKERS_AI_DEFAULT_PROVIDER,
      enabled: false,
      apiKey: "cf-token",
    });
  });

  test("a malformed stored Workers AI entry self-heals to the defaults", async () => {
    await fakeKv.put("settings:provider:workers-ai", "not-json");
    expect(await getCustomProvider("workers-ai")).toEqual({ ...WORKERS_AI_DEFAULT_PROVIDER });
  });

  test("listAdminProviders puts the built-in service first, then stored providers", async () => {
    await saveCustomProvider(makeProvider({ id: "relay", name: "Relay" }));

    const providers = await listAdminProviders();
    expect(providers?.map((provider) => provider.id)).toEqual(["workers-ai", "relay"]);
    expect(providers?.[0]).toEqual({ ...WORKERS_AI_DEFAULT_PROVIDER });
  });
});

describe("generateProviderId", () => {
  test("slugifies names and avoids collisions", () => {
    expect(generateProviderId("New API!", [])).toBe("new-api");
    expect(generateProviderId("New API", ["new-api"])).toMatch(/^new-api-[a-f0-9]{4}$/);
    expect(generateProviderId("中文", [])).toBe("provider");
  });
});

describe("without a KV namespace", () => {
  beforeEach(() => {
    contextRef.env = {};
  });

  test("all operations degrade gracefully", async () => {
    expect(await getCustomProvider("openai")).toBeUndefined();
    expect(await listCustomProviders()).toBeUndefined();
    expect(await saveCustomProvider(makeProvider())).toBe(false);
    expect(await deleteCustomProvider("openai")).toBe(false);
  });
});

test("without a Cloudflare context all operations degrade gracefully", async () => {
  const savedEnv = contextRef.env;
  contextRef.env = null;

  try {
    expect(await getCustomProvider("openai")).toBeUndefined();
    expect(await listCustomProviders()).toBeUndefined();
  } finally {
    contextRef.env = savedEnv;
  }
});
