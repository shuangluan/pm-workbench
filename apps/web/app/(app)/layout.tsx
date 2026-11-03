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
        <nav aria-label="主导航">
          <Link href="/">产品</Link>
          <Link href="/import">导入</Link>
          <Link href="/settings">设置与诊断</Link>
          <form action={logoutAction}>
            <button type="submit" className="linklike">
              退出
            </button>
          </form>
        </nav>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
