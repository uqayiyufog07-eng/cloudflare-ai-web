import { afterEach, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { createSessionToken, getAuthCookieName } from "@/lib/auth";
import { proxy } from "@/proxy";

const PASSWORD = "access-secret";

const request = (path: string, cookie?: string) =>
  new NextRequest(`https://example.com${path}`, {
    headers: cookie ? { cookie: `${getAuthCookieName()}=${cookie}` } : undefined,
  });

afterEach(() => {
  delete process.env.APP_PASSWORD;
});

test("conversation APIs return 401 without a session cookie when APP_PASSWORD is set", async () => {
  process.env.APP_PASSWORD = PASSWORD;

  for (const path of [
    "/api/conversations",
    "/api/conversations/abc",
    "/api/conversations/abc/messages",
  ]) {
    const response = await proxy(request(path));
    expect(response.status, path).toBe(401);
  }
});

test("conversation APIs pass with a valid session cookie", async () => {
  process.env.APP_PASSWORD = PASSWORD;
  const cookie = await createSessionToken(PASSWORD);

  const response = await proxy(request("/api/conversations", cookie));
  expect(response.status).toBe(200);
});

test("auth and admin paths stay open even without a user session cookie", async () => {
  process.env.APP_PASSWORD = PASSWORD;

  expect((await proxy(request("/api/auth"))).status).toBe(200);
  expect((await proxy(request("/api/admin/keys"))).status).toBe(200);
});

test("all APIs are public when APP_PASSWORD is not configured", async () => {
  expect((await proxy(request("/api/conversations"))).status).toBe(200);
});
