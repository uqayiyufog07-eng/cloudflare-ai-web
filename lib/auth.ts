/**
 * Stateless Access Session using HMAC-signed cookies.
 *
 * When APP_PASSWORD is set, protected inference APIs require a valid session cookie.
 * The cookie contains an expiry timestamp and an HMAC-SHA256 proof derived from the password.
 * No raw password or server-side session store is involved; changing APP_PASSWORD
 * immediately invalidates all outstanding tokens.
 *
 * The same mechanism backs the admin session (see ADMIN_COOKIE_NAME): the cookie name
 * participates in the HMAC proof, so user and admin tokens are not interchangeable.
 */

import { findApiKeyByToken, touchApiKey } from "@/lib/api-keys";

const COOKIE_NAME = "cf-ai-auth";
const ADMIN_COOKIE_NAME = "cf-admin-auth";
const COOKIE_MAX_AGE_DAYS = 30;
const COOKIE_MAX_AGE_SECONDS = COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;
const COOKIE_PATH = "/api";

const encoder = new TextEncoder();

const base64urlEncode = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const base64urlDecode = (value: string): Uint8Array | null => {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

const importKey = async (secret: string): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
};

const createProof = async (
  key: CryptoKey,
  expiry: number,
  cookieName: string,
): Promise<string> => {
  const data = encoder.encode(`${expiry}:${cookieName}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return base64urlEncode(signature);
};

/**
 * Creates a signed session cookie value: `<expiry>.<proof>`.
 * The proof is bound to the cookie name, so tokens issued for different
 * cookie names (user vs admin) are not interchangeable.
 */
export const createSessionToken = async (
  password: string,
  cookieName: string = COOKIE_NAME,
): Promise<string> => {
  const expiry = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;
  const key = await importKey(password);
  const proof = await createProof(key, expiry, cookieName);
  return `${expiry}.${proof}`;
};

/**
 * Verifies a session cookie value against the current password using constant-time comparison.
 * Returns true if the token is valid and not expired.
 */
export const verifySessionToken = async (
  token: string,
  password: string,
  cookieName: string = COOKIE_NAME,
): Promise<boolean> => {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return false;
  }

  const expiry = Number(parts[0]);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const key = await importKey(password);
  const expectedProof = await createProof(key, expiry, cookieName);
  const providedProof = parts[1];

  const expected = base64urlDecode(expectedProof);
  const provided = base64urlDecode(providedProof);
  if (!expected || !provided || expected.length !== provided.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected[i] ^ provided[i];
  }
  return diff === 0;
};

/** Compares fixed-length digests so the password length is not exposed by an early return. */
export const constantTimeCompare = async (a: string, b: string): Promise<boolean> => {
  const [aDigest, bDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const aBytes = new Uint8Array(aDigest);
  const bBytes = new Uint8Array(bDigest);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
};

export const getAuthCookieName = () => COOKIE_NAME;
export const getAdminCookieName = () => ADMIN_COOKIE_NAME;
export const getAuthCookiePath = () => COOKIE_PATH;
export const getAuthCookieMaxAge = () => COOKIE_MAX_AGE_SECONDS;

/**
 * Builds the Set-Cookie header value for a session cookie.
 */
export const buildCookieHeader = (token: string, cookieName: string = COOKIE_NAME): string => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`;
};

/** Builds the Set-Cookie header value for the admin session cookie. */
export const buildAdminCookieHeader = (token: string): string =>
  buildCookieHeader(token, ADMIN_COOKIE_NAME);

const parseCookieValue = (header: string, name: string): string | undefined => {
  const cookie = header
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));

  return cookie?.slice(name.length + 1);
};

/**
 * Extracts and verifies the session cookie from a request's Cookie header.
 * Returns true if authentication is disabled (no APP_PASSWORD) or the cookie is valid.
 */
export const isRequestAuthorized = async (request: Request): Promise<boolean> => {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return true;
  }

  const token = parseCookieValue(request.headers.get("cookie") ?? "", COOKIE_NAME);
  if (!token) {
    return false;
  }

  return verifySessionToken(token, password);
};

/**
 * The password protecting the /admin console. ADMIN_PASSWORD takes precedence;
 * otherwise the deployment access password doubles as the admin password.
 * Returns undefined when neither is configured (admin is disabled).
 */
export const getAdminPassword = (): string | undefined =>
  process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD;

/**
 * Extracts and verifies the admin session cookie from a request's Cookie header.
 * Returns false when the admin password is not configured.
 */
export const isAdminRequestAuthorized = async (request: Request): Promise<boolean> => {
  const password = getAdminPassword();
  if (!password) {
    return false;
  }

  const token = parseCookieValue(request.headers.get("cookie") ?? "", ADMIN_COOKIE_NAME);
  if (!token) {
    return false;
  }

  return verifySessionToken(token, password, ADMIN_COOKIE_NAME);
};

/**
 * Guard for /api/admin handlers: returns a 503 response when the admin
 * password is not configured, a 401 response when the admin session cookie is
 * missing or invalid, and undefined when the request may proceed.
 */
export const requireAdmin = async (request: Request): Promise<Response | undefined> => {
  if (!getAdminPassword()) {
    return new Response("Admin is not configured for this deployment.", { status: 503 });
  }
  if (!(await isAdminRequestAuthorized(request))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return undefined;
};

/**
 * The API key accepted by the OpenAI-compatible endpoints in the Authorization header.
 * OPENAI_API_KEY takes precedence; otherwise the deployment access password doubles
 * as the API key. Returns undefined when neither is configured.
 */
export const getOpenAiApiKey = (): string | undefined =>
  process.env.OPENAI_API_KEY || process.env.APP_PASSWORD;

const unauthorizedResponse = () =>
  new Response(
    JSON.stringify({
      error: {
        message: "Missing or invalid API key. Set the Authorization header to 'Bearer <key>'.",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  );

/**
 * Verifies the Authorization: Bearer header of an OpenAI-compatible request.
 *
 * Precedence: a matching key stored in the API_KEYS KV namespace, then the static
 * environment key (OPENAI_API_KEY or APP_PASSWORD). When no key source is
 * configured at all the deployment is public. When the KV store exists, a valid
 * Bearer key is always required.
 */
export const authorizeOpenAiRequest = async (
  request: Request,
): Promise<{ ok: true } | { ok: false; response: Response }> => {
  const header = request.headers.get("authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  // Three states: the key record on hit, null on miss, undefined when no KV store.
  const record = await findApiKeyByToken(bearerToken);
  if (record) {
    await touchApiKey(bearerToken as string, record);
    return { ok: true };
  }

  const envKey = getOpenAiApiKey();
  if (envKey) {
    return bearerToken && (await constantTimeCompare(bearerToken, envKey))
      ? { ok: true }
      : { ok: false, response: unauthorizedResponse() };
  }

  // Public deployment, but only when no dynamic key store is configured.
  return record === undefined
    ? { ok: true }
    : { ok: false, response: unauthorizedResponse() };
};
