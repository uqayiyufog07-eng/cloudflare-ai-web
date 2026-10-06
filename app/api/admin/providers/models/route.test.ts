import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { POST } from "@/app/api/admin/providers/models/route";
import { createSessionToken, getAdminCookieName } from "@/lib/auth";

const ADMIN_PASSWORD = "admin-secret";

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
let adminCookie: string;
let fetchCalls: Array<{ url: string; headers: Record<string, string> }>;
let fetchResponse: () => Response;

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

const originalFetch = globalThis.fetch;

const adminRequest = (body: unknown) =>
  new Request("https://example.com/api/admin/providers/models", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${getAdminCookieName()}=${adminCookie}`,
    },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  fakeKv = new FakeKv();
  contextRef.env = { API_KEYS: fakeKv };
  fetchCalls = [];
  fetchResponse = () => new Response("{}", { status: 200 });

  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  adminCookie = await createSessionToken(ADMIN_PASSWORD, getAdminCookieName());

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers)),
    });
    return fetchResponse();
  }) as typeof fetch;
});

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
  globalThis.fetch = originalFetch;
  // Neutralize the mocked context so later test files degrade gracefully.
  contextRef.env = null;
});

describe("POST /api/admin/providers/models", () => {
  test("returns 401 without an admin cookie", async () => {
    const response = await POST(
      new Request("https://example.com/api/admin/providers/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
  });

  test("returns 400 when no API key is available", async () => {
    const response = await POST(adminRequest({ provider: "openai" }));
    expect(response.status).toBe(400);
  });

  test("probes an OpenAI-compatible endpoint with the submitted key", async () => {
    fetchResponse = () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5.2" }, { id: "text-embedding-3" }] }), {
        status: 200,
      });

    const response = await POST(
      adminRequest({ provider: "openai", apiKey: "sk-x", baseUrl: "https://aihubmix.com/v1" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["gpt-5.2"] });
    expect(fetchCalls[0].url).toBe("https://aihubmix.com/v1/models");
    expect(fetchCalls[0].headers.authorization).toBe("Bearer sk-x");
  });

  test("uses stored settings when the body only names the provider", async () => {
    await fakeKv.put(
      "settings:google",
      JSON.stringify({ apiKey: "goog-key", baseUrl: "https://gemini.example.com/v1beta" }),
    );
    fetchResponse = () =>
      new Response(
        JSON.stringify({
          models: [{ name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"] }],
        }),
        { status: 200 },
      );

    const response = await POST(adminRequest({ provider: "google" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["gemini-3.6-flash"] });
    expect(fetchCalls[0].url).toBe("https://gemini.example.com/v1beta/models");
    expect(fetchCalls[0].headers["x-goog-api-key"]).toBe("goog-key");
  });

  test("returns 502 when the upstream endpoint fails", async () => {
    fetchResponse = () => new Response("Internal Server Error", { status: 500 });

    const response = await POST(adminRequest({ provider: "openai", apiKey: "sk-x" }));

    expect(response.status).toBe(502);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/models");
  });
});
