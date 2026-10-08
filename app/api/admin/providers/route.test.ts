import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GET, POST } from "@/app/api/admin/providers/route";
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

const providersUrl = "https://example.com/api/admin/providers";

const adminRequest = (init?: RequestInit) =>
  new Request(providersUrl, {
    headers: { cookie: `${getAdminCookieName()}=${adminCookie}` },
    ...init,
  });

const postInit = (body: unknown): RequestInit => ({
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
    const response = await GET(new Request(providersUrl));
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

  test("returns an empty list when nothing is configured", async () => {
    const response = await GET(adminRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: [] });
  });
});

describe("POST /api/admin/providers", () => {
  test("creates a provider with a generated id and normalized values", async () => {
    const response = await POST(
      adminRequest(
        postInit({
          name: " My Relay ",
          style: "openai",
          baseUrl: " https://aihubmix.com/v1 ",
        }),
      ),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      provider: { id: string; name: string; style: string; enabled: boolean; baseUrl: string };
    };
    expect(body.provider).toMatchObject({
      id: "my-relay",
      name: "My Relay",
      style: "openai",
      enabled: true,
      baseUrl: "https://aihubmix.com/v1",
    });

    const stored = await fakeKv.get("settings:provider:my-relay");
    expect(stored).not.toBeNull();
  });

  test("creates a gemini-style provider", async () => {
    const response = await POST(adminRequest(postInit({ name: "Gemini", style: "gemini" })));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { provider: { id: string; style: string } };
    expect(body.provider).toMatchObject({ id: "gemini", style: "gemini" });
  });

  test("rejects duplicate names with 409", async () => {
    const first = await POST(adminRequest(postInit({ name: "Relay", style: "openai" })));
    expect(first.status).toBe(201);

    const second = await POST(adminRequest(postInit({ name: "relay ", style: "gemini" })));
    expect(second.status).toBe(409);
  });

  test("rejects an invalid style with 400", async () => {
    const response = await POST(adminRequest(postInit({ name: "x", style: "webdav" })));
    expect(response.status).toBe(400);
  });

  test("rejects a non-http base URL with 400", async () => {
    const response = await POST(
      adminRequest(postInit({ name: "x", style: "openai", baseUrl: "ftp://example.com/v1" })),
    );
    expect(response.status).toBe(400);
  });

  test("returns 401 without an admin cookie", async () => {
    const response = await POST(
      new Request(providersUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", style: "openai" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  test("returns 503 when no KV store is configured", async () => {
    contextRef.env = {};
    try {
      const response = await POST(adminRequest(postInit({ name: "x", style: "openai" })));
      expect(response.status).toBe(503);
    } finally {
      contextRef.env = { API_KEYS: fakeKv };
    }
  });
});
