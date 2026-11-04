"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page while a run is queued or running, so results appear on their own. */
export function RunWatcher({ url, active }: { url: string; active: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const res = await fetch(url, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const runs = (await res.json()) as { id: string; status: string }[];
      const now = runs.filter((r) => r.status === "queued" || r.status === "running").map((r) => `${r.id}:${r.status}`).join();
      if (now !== active) router.refresh();
    }, 1500);
    return () => clearInterval(timer);
  }, [url, active, router]);
  return null;
}
