import { expect, test } from "bun:test";
import { POST as login } from "@/app/api/admin/login/route";

const loginRequest = (init?: RequestInit) =>
  new Request("https://example.com/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });

const withEnvPassword = async (run: () => Promise<void>) => {
  const original = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "admin-secret";
  try {
    await run();
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = original;
    }
  }
};

test("login returns 503 when no admin password is configured", async () => {
  const originalAdmin = process.env.ADMIN_PASSWORD;
  const originalApp = process.env.APP_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.APP_PASSWORD;
  try {
    const response = await login(loginRequest({ body: JSON.stringify({ password: "x" }) }));
    expect(response.status).toBe(503);
  } finally {
    if (originalAdmin === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = originalAdmin;
    }
    if (originalApp === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = originalApp;
    }
  }
});

test("login rejects cross-site requests with 403", async () => {
  await withEnvPassword(async () => {
    const response = await login(
      loginRequest({
        headers: { origin: "https://evil.example" },
        body: JSON.stringify({ password: "admin-secret" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});

test("login rejects a wrong password with 401", async () => {
  await withEnvPassword(async () => {
    const response = await login(loginRequest({ body: JSON.stringify({ password: "wrong" }) }));
    expect(response.status).toBe(401);
  });
});

test("login issues an HttpOnly admin cookie on success", async () => {
  await withEnvPassword(async () => {
    const response = await login(
      loginRequest({ body: JSON.stringify({ password: "admin-secret" }) }),
    );
    expect(response.status).toBe(200);

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("cf-admin-auth=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("admin-secret");
  });
});
