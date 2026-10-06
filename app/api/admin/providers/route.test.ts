import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GET, PUT } from "@/app/api/admin/providers/route";
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

const adminRequest = (init?: RequestInit) =>
  new Request("https://example.com/api/admin/providers", {
    headers: { cookie: `${getAdminCookieName()}=${adminCookie}` },
    ...init,
  });

const jsonInit = (method: "PUT", body: unknown): RequestInit => ({
  method,
  headers: {
    "content-type": "application/json",
    cookie: `${getAdminCookieName()}=${adminCookie}`,
  },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  fakeKv = new FakeKv();
  contextRef.env = { API_KEYS: fakeKv };

  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  adminCookie = await createSessionToken(ADMIN_PASSWORD, getAdminCookieName());
});

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
  // Neutralize the mocked context so later test files degrade gracefully.
  contextRef.env = null;
});

describe("GET /api/admin/providers", () => {
  test("returns 401 without an admin cookie", async () => {
    const response = await GET(new Request("https://example.com/api/admin/providers"));
    expect(response.status).toBe(401);
  });

  test("returns 503 when no KV store is configured", async () => {
    contextRef.env = {};
    try {
      const response = await GET(adminRequest());
      expect(response.status).toBe(503);
    } finally {
      contextRef.env = { API_KEYS: fakeKv };
    }
  });

  test("returns empty providers when nothing is configured", async () => {
    const response = await GET(adminRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: {} });
  });
});

describe("PUT /api/admin/providers", () => {
  test("saves settings with trimmed values and deduped models", async () => {
    const response = await PUT(
      adminRequest(
        jsonInit("PUT", {
          openai: {
            apiKey: " sk-upstream ",
            baseUrl: " https://aihubmix.com/v1 ",
            models: [" gpt-5.2 ", "gpt-5.2", "claude-x"],
          },
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providers: {
        openai: {
          apiKey: "sk-upstream",
          baseUrl: "https://aihubmix.com/v1",
          models: ["gpt-5.2", "claude-x"],
        },
      },
    });

    const stored = await fakeKv.get("settings:openai");
    expect(JSON.parse(stored as string)).toEqual({
      apiKey: "sk-upstream",
      baseUrl: "https://aihubmix.com/v1",
      models: ["gpt-5.2", "claude-x"],
    });
  });

  test("clears a provider when null is sent", async () => {
    await fakeKv.put("settings:google", JSON.stringify({ apiKey: "goog" }));

    const response = await PUT(adminRequest(jsonInit("PUT", { google: null })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: {} });
    expect(await fakeKv.get("settings:google")).toBeNull();
  });

  test("rejects a missing API key with 400", async () => {
    const response = await PUT(adminRequest(jsonInit("PUT", { openai: { baseUrl: "https://api.openai.com/v1" } })));
    expect(response.status).toBe(400);
  });

  test("rejects a non-http base URL with 400", async () => {
    const response = await PUT(
      adminRequest(jsonInit("PUT", { openai: { apiKey: "sk-x", baseUrl: "ftp://example.com/v1" } })),
    );
    expect(response.status).toBe(400);
  });

  test("rejects empty model ids with 400", async () => {
    const response = await PUT(
      adminRequest(jsonInit("PUT", { openai: { apiKey: "sk-x", models: ["valid", ""] } })),
    );
    expect(response.status).toBe(400);
  });

  test("returns 401 without an admin cookie", async () => {
    const response = await PUT(
      new Request("https://example.com/api/admin/providers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openai: { apiKey: "sk-x" } }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("returns 503 when no KV store is configured", async () => {
    contextRef.env = {};
    try {
      const response = await PUT(adminRequest(jsonInit("PUT", { openai: { apiKey: "sk-x" } })));
      expect(response.status).toBe(503);
    } finally {
      contextRef.env = { API_KEYS: fakeKv };
    }
  });
});
