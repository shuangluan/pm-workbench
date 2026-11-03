import { SESSION_COOKIE, SESSION_TTL_MS, validateSession } from "@pew/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "./config";
import { getDb } from "./db";

export async function isSignedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSession(await getDb(), config.dataDir, token);
}

/** Every page and action behind the login calls this; the proxy only checks the cookie exists. */
export async function requireSession(): Promise<void> {
  if (!(await isSignedIn())) redirect("/login");
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    // Loopback over plain HTTP: a Secure cookie would never be sent back.
    secure: false,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
