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
  contextRef.env = null;
});

describe("POST /api/admin/providers/models", () => {
  test("returns 401 without an admin cookie", async () => {
    const response = await POST(
      new Request("https://example.com/api/admin/providers/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ style: "openai", apiKey: "sk-x" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
  });

  test("returns 400 when neither an id nor a style with key is provided", async () => {
    const response = await POST(adminRequest({}));
    expect(response.status).toBe(400);
  });

  test("returns 400 when no API key is available", async () => {
    const response = await POST(adminRequest({ style: "openai" }));
    expect(response.status).toBe(400);
  });

  test("probes an OpenAI-style endpoint with the submitted key", async () => {
    fetchResponse = () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-5.2" }, { id: "text-embedding-3" }] }), {
        status: 200,
      });

    const response = await POST(
      adminRequest({ style: "openai", apiKey: "sk-x", baseUrl: "https://aihubmix.com/v1" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["gpt-5.2"] });
    expect(fetchCalls[0].url).toBe("https://aihubmix.com/v1/models");
    expect(fetchCalls[0].headers.authorization).toBe("Bearer sk-x");
  });

  test("probes a stored provider using its style and credentials", async () => {
    await fakeKv.put(
      "settings:provider:gem",
      JSON.stringify({
        id: "gem",
        name: "Gem",
        style: "gemini",
        enabled: true,
        apiKey: "goog-key",
        baseUrl: "https://gemini.example.com/v1beta",
        createdAt: "2026-10-07T00:00:00.000Z",
      }),
    );
    fetchResponse = () =>
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-3.6-flash",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
        { status: 200 },
      );

    const response = await POST(adminRequest({ id: "gem" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["gemini-3.6-flash"] });
    expect(fetchCalls[0].url).toBe("https://gemini.example.com/v1beta/models");
    expect(fetchCalls[0].headers["x-goog-api-key"]).toBe("goog-key");
  });

  test("lets a submitted key override the stored one", async () => {
    await fakeKv.put(
      "settings:provider:relay",
      JSON.stringify({
        id: "relay",
        name: "Relay",
        style: "openai",
        enabled: true,
        apiKey: "sk-stored",
        createdAt: "2026-10-07T00:00:00.000Z",
      }),
    );
    fetchResponse = () =>
      new Response(JSON.stringify({ data: [{ id: "gpt-x" }] }), { status: 200 });

    const response = await POST(adminRequest({ id: "relay", apiKey: "sk-draft" }));

    expect(response.status).toBe(200);
    expect(fetchCalls[0].headers.authorization).toBe("Bearer sk-draft");
  });

  test("returns 404 for an unknown provider id", async () => {
    const response = await POST(adminRequest({ id: "ghost" }));
    expect(response.status).toBe(404);
  });

  test("returns 502 when the upstream endpoint fails", async () => {
    fetchResponse = () => new Response("Internal Server Error", { status: 500 });

    const response = await POST(adminRequest({ style: "openai", apiKey: "sk-x" }));

    expect(response.status).toBe(502);
    expect(fetchCalls[0].url).toBe("https://api.openai.com/v1/models");
  });
});

describe("POST /api/admin/providers/models for the built-in Workers AI service", () => {
  const originalAccountId = process.env.CF_ACCOUNT_ID;
  const originalToken = process.env.CF_WORKERS_AI_TOKEN;

  const withEnv = async (
    body: unknown,
    accountId?: string,
    token?: string,
  ): Promise<Response> => {
    if (accountId === undefined) {
      delete process.env.CF_ACCOUNT_ID;
    } else {
      process.env.CF_ACCOUNT_ID = accountId;
    }
    if (token === undefined) {
      delete process.env.CF_WORKERS_AI_TOKEN;
    } else {
      process.env.CF_WORKERS_AI_TOKEN = token;
    }
    return POST(adminRequest(body));
  };

  test("probes the Cloudflare catalog with the submitted token", async () => {
    fetchResponse = () => new Response(JSON.stringify({ success: true }), { status: 200 });

    const response = await withEnv(
      { style: "workers-ai", apiKey: "cf-token" },
      "account-123",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
    expect(fetchCalls[0].url).toContain(
      "https://api.cloudflare.com/client/v4/accounts/account-123/ai/models/search",
    );
    expect(fetchCalls[0].headers.authorization).toBe("Bearer cf-token");

    process.env.CF_ACCOUNT_ID = originalAccountId;
    process.env.CF_WORKERS_AI_TOKEN = originalToken;
  });

  test("falls back to the deployment token for the built-in provider id", async () => {
    fetchResponse = () => new Response(JSON.stringify({ success: true }), { status: 200 });

    const response = await withEnv({ id: "workers-ai" }, "account-123", "env-token");

    expect(response.status).toBe(200);
    expect(fetchCalls[0].headers.authorization).toBe("Bearer env-token");

    process.env.CF_ACCOUNT_ID = originalAccountId;
    process.env.CF_WORKERS_AI_TOKEN = originalToken;
  });

  test("returns 400 when no token is available", async () => {
    const response = await withEnv({ style: "workers-ai" }, "account-123");
    expect(response.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);

    process.env.CF_ACCOUNT_ID = originalAccountId;
    process.env.CF_WORKERS_AI_TOKEN = originalToken;
  });

  test("returns 503 when CF_ACCOUNT_ID is missing", async () => {
    const response = await withEnv({ style: "workers-ai", apiKey: "cf-token" });
    expect(response.status).toBe(503);

    process.env.CF_ACCOUNT_ID = originalAccountId;
    process.env.CF_WORKERS_AI_TOKEN = originalToken;
  });

  test("returns 502 when Cloudflare rejects the credentials", async () => {
    fetchResponse = () => new Response("Unauthorized", { status: 401 });

    const response = await withEnv(
      { style: "workers-ai", apiKey: "bad-token" },
      "account-123",
    );
    expect(response.status).toBe(502);

    process.env.CF_ACCOUNT_ID = originalAccountId;
    process.env.CF_WORKERS_AI_TOKEN = originalToken;
  });
});
