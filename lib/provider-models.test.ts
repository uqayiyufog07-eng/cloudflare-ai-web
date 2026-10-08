import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { fetchUpstreamModelIds, getUpstreamModels } from "@/lib/provider-models";
import type { CustomProvider } from "@/lib/provider-settings";

const originalFetch = globalThis.fetch;

let fetchCalls: number;
let fetchResponse: () => Response;

const makeProvider = (overrides: Partial<CustomProvider> = {}): CustomProvider => ({
  id: "test-provider",
  name: "Test Provider",
  style: "openai",
  enabled: true,
  apiKey: "sk-x",
  createdAt: "2026-10-07T00:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  fetchCalls = 0;
  fetchResponse = () => new Response("{}", { status: 200 });

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return fetchResponse();
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchUpstreamModelIds", () => {
  test("parses, dedupes, filters and sorts OpenAI-compatible lists", async () => {
    fetchResponse = () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "gpt-5.2" },
            { id: "gpt-5.2" },
            { id: "claude-sonnet-4.5" },
            { id: "text-embedding-3-large" },
            { id: "whisper-1" },
            { id: "tts-1" },
            { id: "dall-e-3" },
            { id: "gpt-image-1" },
            { id: "omni-moderation-latest" },
            { id: "" },
          ],
        }),
        { status: 200 },
      );

    expect(await fetchUpstreamModelIds("openai", { apiKey: "sk-x" })).toEqual([
      "claude-sonnet-4.5",
      "gpt-5.2",
    ]);
  });

  test("parses Gemini lists, keeps generateContent models and strips the prefix", async () => {
    fetchResponse = () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
            { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] },
          ],
        }),
        { status: 200 },
      );

    expect(await fetchUpstreamModelIds("gemini", { apiKey: "goog" })).toEqual([
      "gemini-3.6-flash",
    ]);
  });

  test("throws when the endpoint responds with an error status", async () => {
    fetchResponse = () => new Response("nope", { status: 401 });

    await expect(fetchUpstreamModelIds("openai", { apiKey: "sk-x" })).rejects.toThrow(
      "the endpoint returned 401",
    );
  });
});

describe("getUpstreamModels", () => {
  test("maps stored model ids without touching the network", async () => {
    const provider = makeProvider({
      apiKey: "sk-x",
      models: ["gpt-5.2", "claude-x", "deepseek-chat", "grok-3"],
    });

    const models = await getUpstreamModels(provider);
    expect(models).toEqual([
      {
        id: "gpt-5.2",
        name: "gpt-5.2",
        brand: "OpenAI",
        type: "Text Generation",
        provider: "test-provider",
        providerName: "Test Provider",
        source: "external",
      },
      {
        id: "claude-x",
        name: "claude-x",
        brand: "Anthropic",
        type: "Text Generation",
        provider: "test-provider",
        providerName: "Test Provider",
        source: "external",
      },
      {
        id: "deepseek-chat",
        name: "deepseek-chat",
        brand: "DeepSeek",
        type: "Text Generation",
        provider: "test-provider",
        providerName: "Test Provider",
        source: "external",
      },
      {
        id: "grok-3",
        name: "grok-3",
        brand: "xAI",
        type: "Text Generation",
        provider: "test-provider",
        providerName: "Test Provider",
        source: "external",
      },
    ]);
    expect(fetchCalls).toBe(0);
  });

  test("maps Gemini models with image and search inputs", async () => {
    const models = await getUpstreamModels(
      makeProvider({ id: "google", name: "Google", style: "gemini", apiKey: "goog", models: ["gemini-x"] }),
    );
    expect(models).toEqual([
      {
        id: "gemini-x",
        name: "gemini-x",
        brand: "Google",
        type: "Text Generation",
        provider: "google",
        providerName: "Google",
        source: "external",
        input: ["image", "search"],
      },
    ]);
  });

  test("returns nothing for disabled providers", async () => {
    const models = await getUpstreamModels(makeProvider({ enabled: false }));
    expect(models).toEqual([]);
    expect(fetchCalls).toBe(0);
  });

  test("fetches when no models are stored and caches the result", async () => {
    fetchResponse = () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5.2" }] }), { status: 200 });

    const provider = makeProvider({ id: "cache-a", apiKey: "sk-cache-a" });
    const first = await getUpstreamModels(provider);
    const second = await getUpstreamModels(provider);

    expect(first.map((model) => model.id)).toEqual(["gpt-5.2"]);
    expect(second).toBe(first);
    expect(fetchCalls).toBe(1);
  });

  test("refetches when the settings change", async () => {
    fetchResponse = () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5.2" }] }), { status: 200 });

    await getUpstreamModels(makeProvider({ id: "cache-b", apiKey: "sk-cache-b" }));
    await getUpstreamModels(
      makeProvider({ id: "cache-b", apiKey: "sk-cache-c", baseUrl: "https://proxy.example.com/v1" }),
    );

    expect(fetchCalls).toBe(2);
  });

  test("degrades to an empty list when the endpoint fails", async () => {
    fetchResponse = () => new Response("nope", { status: 500 });

    const models = await getUpstreamModels(makeProvider({ id: "fail-a", apiKey: "sk-fail-a" }));
    expect(models).toEqual([]);
  });

  test("serves stale cached models when a refresh later fails", async () => {
    fetchResponse = () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5.2" }] }), { status: 200 });
    const provider = makeProvider({ id: "stale", apiKey: "sk-stale" });
    await getUpstreamModels(provider);

    const realNow = Date.now();
    setSystemTime(new Date(realNow + 2 * 60 * 60 * 1000));

    try {
      fetchResponse = () => new Response("nope", { status: 500 });
      const models = await getUpstreamModels(provider);
      expect(models.map((model) => model.id)).toEqual(["gpt-5.2"]);
    } finally {
      setSystemTime(new Date(realNow));
    }
  });
});
