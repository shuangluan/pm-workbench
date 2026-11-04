import { listProducts } from "@pew/db";
import Link from "next/link";
import { quickStartAction } from "@/app/actions";
import { QuickStartForm } from "@/components/QuickStartForm";
import { getDb } from "@/lib/db";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const products = (await listProducts(await getDb())).filter((p) => !p.isExample);
  const { product } = await searchParams;
  return (
    <>
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <span>快速开始</span>
      </nav>
      <h1>快速开始一次分析</h1>
      <p className="muted">
        把手头的需求和资料一次放进来：可以粘贴聊天记录、表格或截图。保存后会直接进入分析页，范围已经选好。所有内容只保存在本机。
      </p>
      <QuickStartForm
        action={quickStartAction}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
        defaultProductId={products.some((p) => p.id === product) ? product : undefined}
        // A new key per page load: resubmitting the same form returns the same analysis.
        batchKey={crypto.randomUUID()}
      />
    </>
  );
}
