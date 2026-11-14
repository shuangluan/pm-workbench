// Where a model request may go (PRD §8.2). HTTPS by default; plain HTTP only
// to this machine, and only after an explicit opt-in. Cloud metadata targets
// are refused outright, and redirects are never followed, so a validated
// endpoint cannot bounce a request (and its API key) somewhere else.

import { ModelError } from "./types";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.goog", "100.100.100.200", "[fd00:ec2::254]"]);

function isLinkLocal(host: string): boolean {
  return /^169\.254\./.test(host) || /^\[fe[89ab]/i.test(host) || /^\[::ffff:a9fe:/i.test(host);
}

export function validateEndpoint(raw: string, allowLocalHttp: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ModelError("network", "The endpoint is not a valid URL");
  }
  if (url.username || url.password) throw new ModelError("network", "The endpoint cannot contain a username or password");
  const host = url.hostname.toLowerCase();
  if (METADATA_HOSTS.has(host) || isLinkLocal(host)) throw new ModelError("network", "Cloud metadata and link-local addresses are not allowed");
  if (url.protocol === "https:") return url;
  if (url.protocol !== "http:") throw new ModelError("network", "The endpoint must be an https:// URL");
  if (!allowLocalHttp) throw new ModelError("network", "The endpoint must use HTTPS. For a model on this machine, turn on local model mode.");
  if (!LOOPBACK.has(host)) throw new ModelError("network", "HTTP endpoints are only allowed on this machine");
  return url;
}

/** fetch that refuses redirects: the destination must stay the validated endpoint. */
export const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });
