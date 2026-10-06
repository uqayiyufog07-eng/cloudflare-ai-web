import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  deleteProviderSettings,
  getEnabledProviders,
  getProviderSettings,
  saveProviderSettings,
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

beforeEach(() => {
  fakeKv = new FakeKv();
  contextRef.env = { API_KEYS: fakeKv };
});

describe("with a KV namespace", () => {
  test("saveProviderSettings stores and getProviderSettings round-trips", async () => {
    const saved = await saveProviderSettings("openai", {
      apiKey: "sk-upstream",
      baseUrl: "https://aihubmix.com/v1",
      models: ["gpt-5.2", "claude-x"],
    });
    expect(saved).toBe(true);

    expect(await getProviderSettings("openai")).toEqual({
      apiKey: "sk-upstream",
      baseUrl: "https://aihubmix.com/v1",
      models: ["gpt-5.2", "claude-x"],
    });
  });

  test("getProviderSettings returns null for a miss and rejects malformed values", async () => {
    expect(await getProviderSettings("google")).toBeNull();

    await fakeKv.put("settings:openai", "not-json");
    expect(await getProviderSettings("openai")).toBeNull();

    await fakeKv.put("settings:google", JSON.stringify({ baseUrl: "https://example.com" }));
    expect(await getProviderSettings("google")).toBeNull();

    await fakeKv.put(
      "settings:openai",
      JSON.stringify({ apiKey: "sk-x", models: ["valid", 42, "", null] }),
    );
    expect(await getProviderSettings("openai")).toEqual({ apiKey: "sk-x", models: ["valid"] });
  });

  test("getEnabledProviders returns only configured providers", async () => {
    expect(await getEnabledProviders()).toEqual({});

    await saveProviderSettings("openai", { apiKey: "sk-openai" });
    expect(await getEnabledProviders()).toEqual({ openai: { apiKey: "sk-openai" } });

    await saveProviderSettings("google", { apiKey: "goog", models: ["gemini-x"] });
    expect(await getEnabledProviders()).toEqual({
      openai: { apiKey: "sk-openai" },
      google: { apiKey: "goog", models: ["gemini-x"] },
    });
  });

  test("deleteProviderSettings is idempotent", async () => {
    await saveProviderSettings("google", { apiKey: "k" });

    expect(await deleteProviderSettings("google")).toBe(true);
    expect(await getProviderSettings("google")).toBeNull();

    expect(await deleteProviderSettings("google")).toBe(true);
  });
});

describe("without a KV namespace", () => {
  beforeEach(() => {
    contextRef.env = {};
  });

  test("all operations degrade gracefully", async () => {
    expect(await getProviderSettings("openai")).toBeUndefined();
    expect(await getEnabledProviders()).toBeUndefined();
    expect(await saveProviderSettings("openai", { apiKey: "k" })).toBe(false);
    expect(await deleteProviderSettings("openai")).toBe(false);
  });
});

test("without a Cloudflare context all operations degrade gracefully", async () => {
  const savedEnv = contextRef.env;
  contextRef.env = null;

  try {
    expect(await getProviderSettings("openai")).toBeUndefined();
    expect(await getEnabledProviders()).toBeUndefined();
  } finally {
    contextRef.env = savedEnv;
  }
});
