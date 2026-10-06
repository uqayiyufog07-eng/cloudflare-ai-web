import { type NextRequest, NextResponse } from "next/server";
import { isBearerAuthorized, isRequestAuthorized } from "@/lib/auth";

const unauthorized = () =>
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

export async function proxy(request: NextRequest) {
  // OpenAI-compatible endpoints authenticate with a bearer key instead of a cookie.
  if (request.nextUrl.pathname.startsWith("/v1/")) {
    if (!(await isBearerAuthorized(request))) {
      return unauthorized();
    }
    return NextResponse.next();
  }

  const password = process.env.APP_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  // Allow the auth endpoint through
  if (request.nextUrl.pathname === "/api/auth") {
    return NextResponse.next();
  }

  const authorized = await isRequestAuthorized(request);
  if (!authorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/v1/:path*"],
};
