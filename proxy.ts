import { type NextRequest, NextResponse } from "next/server";
import { isRequestAuthorized } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  // Admin API routes verify their own credentials (admin password + admin
  // cookie, see lib/auth.ts) and must not be gated by the user session below,
  // otherwise an admin without a chat session could not use the console.
  if (request.nextUrl.pathname.startsWith("/api/admin/")) {
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
  matcher: ["/api/:path*"],
};
