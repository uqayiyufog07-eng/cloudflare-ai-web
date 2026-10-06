import * as v from "valibot";
import {
  buildAdminCookieHeader,
  constantTimeCompare,
  createSessionToken,
  getAdminCookieName,
  getAdminPassword,
} from "@/lib/auth";
import { parseJsonRequest } from "@/lib/request-limits";

const MAX_AUTH_BODY_BYTES = 1024;

const loginSchema = v.object({
  password: v.pipe(v.string(), v.minLength(1)),
});

const isCrossSiteRequest = (request: Request) => {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return true;
  }

  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
};

export async function POST(request: Request) {
  const password = getAdminPassword();

  if (!password) {
    return new Response("Admin is not configured for this deployment.", { status: 503 });
  }
  if (isCrossSiteRequest(request)) {
    return new Response("Forbidden", { status: 403 });
  }

  const parsed = await parseJsonRequest(request, loginSchema, MAX_AUTH_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.response;
  }

  if (!(await constantTimeCompare(parsed.data.password, password))) {
    return new Response("Invalid password.", { status: 401 });
  }

  const token = await createSessionToken(password, getAdminCookieName());
  return new Response("Authenticated.", {
    status: 200,
    headers: { "Set-Cookie": buildAdminCookieHeader(token) },
  });
}
