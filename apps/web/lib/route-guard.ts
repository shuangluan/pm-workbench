import { AppError } from "@pew/db";
import { NextResponse } from "next/server";
import { isSignedIn } from "./auth";

/** Route handlers return the §7.4 JSON error shape instead of redirecting. */
export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  if (!(await isSignedIn())) {
    return NextResponse.json({ code: "unauthorized", message: "请先登录", retryable: false, details: {} }, { status: 401 });
  }
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json(err.toJSON(), { status: err.code === "not_found" ? 404 : 400 });
    throw err;
  }
}

export function attachment(body: BodyInit, filename: string, type: string): Response {
  // ASCII fallback for clients that ignore filename*; keeps the extension.
  const fallback = `export${/\.[a-z.]+$/i.exec(filename)?.[0] ?? ""}`;
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
