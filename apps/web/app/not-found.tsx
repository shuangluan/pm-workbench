import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <h1>Page not found</h1>
      <p>It does not exist, or it does not belong to this product.</p>
      <Link href="/">Back to products</Link>
    </main>
  );
}
