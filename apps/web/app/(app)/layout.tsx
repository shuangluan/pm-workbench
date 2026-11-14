import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          PM Evidence Workbench
        </Link>
        <nav aria-label="Main">
          <Link href="/">Products</Link>
          <Link href="/import">Import</Link>
          <Link href="/settings">Settings</Link>
          <form action={logoutAction}>
            <button type="submit" className="linklike">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
