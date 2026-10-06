import { expect, test } from "bun:test";
import {
  constantTimeCompare,
  createSessionToken,
  getAdminCookieName,
  getAdminPassword,
  isAdminRequestAuthorized,
  isRequestAuthorized,
  verifySessionToken,
} from "@/lib/auth";

test("constantTimeCompare accepts equal strings", async () => {
  expect(await constantTimeCompare("abc", "abc")).toBe(true);
});

test("constantTimeCompare rejects different strings and lengths", async () => {
  expect(await constantTimeCompare("abc", "abd")).toBe(false);
  expect(await constantTimeCompare("abc", "ab")).toBe(false);
});

test("verifySessionToken accepts a freshly created token", async () => {
  const password = "test-password";
  const token = await createSessionToken(password);
  expect(await verifySessionToken(token, password)).toBe(true);
});

test("verifySessionToken rejects a token after the password changes", async () => {
  const token = await createSessionToken("password-a");
  expect(await verifySessionToken(token, "password-b")).toBe(false);
});

test("verifySessionToken rejects tampered and malformed proofs", async () => {
  const password = "test-password";
  const token = await createSessionToken(password);
  const [expiry, proof] = token.split(".");

  expect(await verifySessionToken(`${expiry}.${"a".repeat(proof.length)}`, password)).toBe(false);
  expect(await verifySessionToken(`${expiry}.%%%`, password)).toBe(false);
  expect(await verifySessionToken("not-a-valid-token", password)).toBe(false);
});

test("isRequestAuthorized rejects malformed cookies without throwing", async () => {
  const originalPassword = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = "password";
  try {
    const request = new Request("https://example.com/api/chat", {
      headers: { cookie: "theme=dark;cf-ai-auth=9999999999.%%%" },
    });
    expect(await isRequestAuthorized(request)).toBe(false);
  } finally {
    if (originalPassword === undefined) {
      delete process.env.APP_PASSWORD;
    } else {
      process.env.APP_PASSWORD = originalPassword;
    }
  }
});

test("verifySessionToken rejects an expired token", async () => {
  const originalNow = Date.now;
  const issuedAt = originalNow();
  try {
    Date.now = () => issuedAt;
    const token = await createSessionToken("password");
    Date.now = () => issuedAt + 31 * 24 * 60 * 60 * 1000;
    expect(await verifySessionToken(token, "password")).toBe(false);
  } finally {
    Date.now = originalNow;
  }
});

test("admin tokens are bound to the admin cookie name", async () => {
  const password = "admin-password";
  const adminToken = await createSessionToken(password, getAdminCookieName());

  expect(await verifySessionToken(adminToken, password, getAdminCookieName())).toBe(true);
  // The same token must not validate under the user cookie name.
  expect(await verifySessionToken(adminToken, password)).toBe(false);

  const userToken = await createSessionToken(password);
  expect(await verifySessionToken(userToken, password, getAdminCookieName())).toBe(false);
});

test("isAdminRequestAuthorized requires configuration and a valid admin cookie", async () => {
  const originalAdmin = process.env.ADMIN_PASSWORD;
  const originalApp = process.env.APP_PASSWORD;
  const request = (token: string) =>
    new Request("https://example.com/api/admin/keys", {
      headers: { cookie: `${getAdminCookieName()}=${token}` },
    });

  try {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.APP_PASSWORD;
    expect(await isAdminRequestAuthorized(new Request("https://example.com/api/admin/keys"))).toBe(
      false,
    );

    process.env.ADMIN_PASSWORD = "admin-secret";
    const token = await createSessionToken("admin-secret", getAdminCookieName());
    expect(await isAdminRequestAuthorized(request(token))).toBe(true);
    expect(await isAdminRequestAuthorized(request("9999999999.%%%"))).toBe(false);
    expect(await isAdminRequestAuthorized(new Request("https://example.com/api/admin/keys"))).toBe(
      false,
    );
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

test("getAdminPassword falls back to APP_PASSWORD", () => {
  const originalAdmin = process.env.ADMIN_PASSWORD;
  const originalApp = process.env.APP_PASSWORD;

  try {
    delete process.env.ADMIN_PASSWORD;
    process.env.APP_PASSWORD = "app-secret";
    expect(getAdminPassword()).toBe("app-secret");

    process.env.ADMIN_PASSWORD = "admin-secret";
    expect(getAdminPassword()).toBe("admin-secret");

    delete process.env.ADMIN_PASSWORD;
    delete process.env.APP_PASSWORD;
    expect(getAdminPassword()).toBeUndefined();
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
