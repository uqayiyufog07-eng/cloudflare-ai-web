import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DELETE, PATCH } from "@/app/api/admin/providers/[id]/route";
import { createSessionToken, getAdminCookieName } from "@/lib/auth";
import type { CustomProvider } from "@/lib/provider-settings";

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

const makeProvider = (overrides: Partial<CustomProvider> = {}): CustomProvider => ({
  id: "relay",
  name: "Relay",
  style: "openai",
  enabled: true,
  apiKey: "sk-old",
  baseUrl: "https://relay.example/v1",
  createdAt: "2026-10-07T00:00:00.000Z",
  ...overrides,
});

const seedProvider = async (provider = makeProvider()) => {
  await fakeKv.put(`settings:provider:${provider.id}`, JSON.stringify(provider));
  return provider;
};

beforeEach(async () => {
  fakeKv = new FakeKv();
  contextRef.env = { API_KEYS: fakeKv };

  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  adminCookie = await createSessionToken(ADMIN_PASSWORD, getAdminCookieName());
});

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
  contextRef.env = null;
});

const patchRequest = (id: string, body: unknown) =>
  new Request(`https://example.com/api/admin/providers/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: `${getAdminCookieName()}=${adminCookie}`,
    },
    body: JSON.stringify(body),
  });

const deleteRequest = (id: string) =>
  new Request(`https://example.com/api/admin/providers/${id}`, {
    method: "DELETE",
    headers: { cookie: `${getAdminCookieName()}=${adminCookie}` },
  });

const params = (id: string) => Promise.resolve({ id });

describe("PATCH /api/admin/providers/[id]", () => {
  test("updates fields and dedupes models", async () => {
    await seedProvider();

    const response = await PATCH(
      patchRequest("relay", {
        name: " New Name ",
        enabled: false,
        apiKey: " sk-new ",
        models: ["gpt-x", "gpt-x", "claude-y"],
      }),
      { params: params("relay") },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: {
        id: "relay",
        name: "New Name",
        style: "openai",
        enabled: false,
        apiKey: "sk-new",
        baseUrl: "https://relay.example/v1",
        models: ["gpt-x", "claude-y"],
        createdAt: "2026-10-07T00:00:00.000Z",
      },
    });
  });

  test("clears baseUrl and models with null", async () => {
    await seedProvider();

    const response = await PATCH(
      patchRequest("relay", { baseUrl: null, models: null }),
      { params: params("relay") },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { provider: CustomProvider };
    expect(body.provider.baseUrl).toBeUndefined();
    expect(body.provider.models).toBeUndefined();
  });

  test("returns 404 for an unknown provider", async () => {
    const response = await PATCH(patchRequest("ghost", { enabled: false }), {
      params: params("ghost"),
    });
    expect(response.status).toBe(404);
  });

  test("returns 400 for a malformed id", async () => {
    const response = await PATCH(patchRequest("bad id!", { enabled: false }), {
      params: params("bad id!"),
    });
    expect(response.status).toBe(400);
  });

  test("returns 409 when renaming collides with another provider", async () => {
    await seedProvider();
    await seedProvider(makeProvider({ id: "other", name: "Other" }));

    const response = await PATCH(patchRequest("relay", { name: "other" }), {
      params: params("relay"),
    });
    expect(response.status).toBe(409);
  });

  test("returns 401 without an admin cookie", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/admin/providers/relay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
      { params: params("relay") },
    );
    expect(response.status).toBe(401);
  });

  test("returns 503 when no KV store is configured", async () => {
    contextRef.env = {};
    try {
      const response = await PATCH(patchRequest("relay", { enabled: false }), {
        params: params("relay"),
      });
      expect(response.status).toBe(503);
    } finally {
      contextRef.env = { API_KEYS: fakeKv };
    }
  });
});

describe("DELETE /api/admin/providers/[id]", () => {
  test("removes the provider", async () => {
    await seedProvider();

    const response = await DELETE(deleteRequest("relay"), { params: params("relay") });
    expect(response.status).toBe(204);
    expect(await fakeKv.get("settings:provider:relay")).toBeNull();
  });

  test("returns 400 for a malformed id", async () => {
    const response = await DELETE(deleteRequest("bad id!"), { params: params("bad id!") });
    expect(response.status).toBe(400);
  });

  test("returns 401 without an admin cookie", async () => {
    const response = await DELETE(
      new Request("https://example.com/api/admin/providers/relay", { method: "DELETE" }),
      { params: params("relay") },
    );
    expect(response.status).toBe(401);
  });
});
