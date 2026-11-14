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
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Products</Link> / <span>Quick start</span>
      </nav>
      <h1>Quick start an analysis</h1>
      <p className="muted">
        Put in the requests and sources you have, all at once: paste chat logs, tables or screenshots. You then land on the analysis with its scope already selected. Everything stays on this machine.
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
