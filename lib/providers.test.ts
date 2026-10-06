import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createChatModel, ProviderConfigurationError } from "@/lib/providers";
import type { Model } from "@/lib/models";
import type { ProviderSettings } from "@/lib/provider-settings";

class FakeKv {
  store = new Map<string, string>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
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

const ENV_KEYS = [
  "CF_ACCOUNT_ID",
  "CF_WORKERS_AI_TOKEN",
  "CF_AI_GATEWAY_NAME",
  "CF_AI_GATEWAY_TOKEN",
  "GOOGLE_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined> = {};

const openaiModel: Model = {
  id: "gpt-4o-mini",
  name: "gpt-4o-mini",
  brand: "OpenAI",
  type: "Text Generation",
  provider: "openai",
  source: "external",
};

const googleModel: Model = {
  id: "gemini-3.6-flash",
  name: "gemini-3.6-flash",
  brand: "Google",
  type: "Text Generation",
  input: ["image", "search"],
  provider: "google",
  source: "external",
};

const workersModel: Model = {
  id: "@cf/meta/llama-3.1-8b-instruct",
  name: "llama-3.1-8b-instruct",
  brand: "Meta",
  type: "Text Generation",
  provider: "workers-ai",
  source: "cloudflare",
};

const putSettings = async (provider: string, settings: ProviderSettings) => {
  await fakeKv.put(`settings:${provider}`, JSON.stringify(settings));
};

beforeEach(() => {
  fakeKv = new FakeKv();
  contextRef.env = { API_KEYS: fakeKv };

  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // Neutralize the mocked context so later test files degrade gracefully.
  contextRef.env = null;
});

describe("createChatModel with the OpenAI-compatible provider", () => {
  test("uses the admin-configured settings", async () => {
    await putSettings("openai", { apiKey: "sk-upstream", baseUrl: "https://aihubmix.com/v1" });

    const chat = await createChatModel(openaiModel, {});
    expect(chat.model.modelId).toBe("gpt-4o-mini");
    expect(chat.tools).toBeUndefined();
  });

  test("throws when the provider is not configured", async () => {
    await expect(createChatModel(openaiModel, {})).rejects.toBeInstanceOf(
      ProviderConfigurationError,
    );
    await expect(createChatModel(openaiModel, {})).rejects.toThrow(
      "The OpenAI-compatible provider is not configured",
    );
  });

  test("throws when no KV store is configured", async () => {
    contextRef.env = {};
    try {
      await expect(createChatModel(openaiModel, {})).rejects.toBeInstanceOf(
        ProviderConfigurationError,
      );
    } finally {
      contextRef.env = { API_KEYS: fakeKv };
    }
  });
});

describe("createChatModel with the Google provider", () => {
  test("prefers the admin-configured settings without env variables", async () => {
    await putSettings("google", { apiKey: "goog-key", baseUrl: "https://example.com/v1beta" });

    const chat = await createChatModel(googleModel, { search: true });
    expect(chat.model.modelId).toBe("gemini-3.6-flash");
    expect(chat.tools?.google_search).toBeDefined();
  });

  test("falls back to the AI Gateway environment variables", async () => {
    process.env.GOOGLE_API_KEY = "gateway-key";
    process.env.CF_ACCOUNT_ID = "account";
    process.env.CF_AI_GATEWAY_NAME = "gateway";
    process.env.CF_AI_GATEWAY_TOKEN = "token";

    const chat = await createChatModel(googleModel, {});
    expect(chat.model.modelId).toBe("gemini-3.6-flash");
    expect(chat.tools).toBeUndefined();
  });

  test("throws when neither settings nor env variables exist", async () => {
    await expect(createChatModel(googleModel, {})).rejects.toThrow(
      "Missing required environment variable: GOOGLE_API_KEY",
    );
  });
});

describe("createChatModel with Workers AI", () => {
  test("uses the environment credentials", async () => {
    process.env.CF_ACCOUNT_ID = "account";
    process.env.CF_WORKERS_AI_TOKEN = "token";

    const chat = await createChatModel(workersModel, {});
    expect(chat.model.modelId).toBe("@cf/meta/llama-3.1-8b-instruct");
  });

  test("wraps reasoning models with the extract middleware", async () => {
    process.env.CF_ACCOUNT_ID = "account";
    process.env.CF_WORKERS_AI_TOKEN = "token";

    const chat = await createChatModel({ ...workersModel, reasoning: true }, {});
    expect(chat.model.modelId).toBe("@cf/meta/llama-3.1-8b-instruct");
  });

  test("throws when credentials are missing", async () => {
    await expect(createChatModel(workersModel, {})).rejects.toThrow(
      "Missing required environment variable: CF_ACCOUNT_ID",
    );
  });
});
