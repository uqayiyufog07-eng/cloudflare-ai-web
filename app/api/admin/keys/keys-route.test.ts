import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GET as listKeys, POST as createKey } from "@/app/api/admin/keys/route";
import { DELETE as deleteKey } from "@/app/api/admin/keys/[id]/route";
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

const adminRequest = (path: string, init?: RequestInit) =>
  new Request(`https://example.com${path}`, {
    headers: { cookie: `${getAdminCookieName()}=${adminCookie}` },
    ...init,
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

describe("GET /api/admin/keys", () => {
  test("returns 401 without an admin cookie", async () => {
    const response = await listKeys(new Request("https://example.com/api/admin/keys"));
    expect(response.status).toBe(401);
  });

  test("returns 503 when the admin password is not configured", async () => {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.APP_PASSWORD;
    try {
      const response = await listKeys(adminRequest("/api/admin/keys"));
      expect(response.status).toBe(503);
    } finally {
      process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
    }
  });

  test("returns the key list for an authenticated admin", async () => {
    const response = await listKeys(adminRequest("/api/admin/keys"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ keys: [] });
  });
});

describe("POST /api/admin/keys", () => {
  test("creates a key and returns it with 201", async () => {
    const response = await createKey(
      adminRequest("/api/admin/keys", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${getAdminCookieName()}=${adminCookie}` },
        body: JSON.stringify({ name: "integration tests" }),
      }),
    );

    expect(response.status).toBe(201);
    const entry = await response.json();
    expect(entry.name).toBe("integration tests");
    expect(entry.token).toMatch(/^sk-cfw-[0-9a-f]{48}$/);
  });

  test("rejects invalid names with 400", async () => {
    const response = await createKey(
      adminRequest("/api/admin/keys", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${getAdminCookieName()}=${adminCookie}` },
        body: JSON.stringify({ name: "" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test("returns 503 when no KV store is configured", async () => {
    contextRef.env = {};
    try {
      const response = await createKey(
        adminRequest("/api/admin/keys", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `${getAdminCookieName()}=${adminCookie}` },
          body: JSON.stringify({ name: "x" }),
        }),
      );
      expect(response.status).toBe(503);
    } finally {
      contextRef.env = { API_KEYS: fakeKv };
    }
  });
});

describe("DELETE /api/admin/keys/[id]", () => {
  test("deletes an existing key and is idempotent", async () => {
    const created = await createKey(
      adminRequest("/api/admin/keys", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `${getAdminCookieName()}=${adminCookie}` },
        body: JSON.stringify({ name: "to delete" }),
      }),
    );
    const { token } = await created.json();

    const response = await deleteKey(
      adminRequest(`/api/admin/keys/${token}`, {
        method: "DELETE",
        headers: { cookie: `${getAdminCookieName()}=${adminCookie}` },
      }),
      { params: Promise.resolve({ id: token }) },
    );
    expect(response.status).toBe(204);

    const again = await deleteKey(
      adminRequest(`/api/admin/keys/${token}`, {
        method: "DELETE",
        headers: { cookie: `${getAdminCookieName()}=${adminCookie}` },
      }),
      { params: Promise.resolve({ id: token }) },
    );
    expect(again.status).toBe(204);

    const list = await listKeys(adminRequest("/api/admin/keys"));
    expect(((await list.json()) as { keys: unknown[] }).keys).toHaveLength(0);
  });

  test("returns 401 without an admin cookie", async () => {
    const response = await deleteKey(
      new Request("https://example.com/api/admin/keys/sk-cfw-x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "sk-cfw-x" }) },
    );
    expect(response.status).toBe(401);
  });
});
