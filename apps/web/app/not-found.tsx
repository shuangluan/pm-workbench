import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <h1>找不到页面</h1>
      <p>该内容不存在，或不属于当前产品。</p>
      <Link href="/">返回产品列表</Link>
    </main>
  );
}
