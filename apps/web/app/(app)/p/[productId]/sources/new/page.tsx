import { getProduct } from "@pew/db";
import Link from "next/link";
import { addSourcesAction, uploadImagesAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { ScreenshotUploadForm } from "@/components/ScreenshotUploadForm";
import { getDb } from "@/lib/db";
import { found } from "@/lib/found";

export default async function NewSourcePage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await found(getProduct(await getDb(), productId));
  return (
    <>
      <nav className="crumbs" aria-label="位置">
        <Link href="/">产品</Link> / <Link href={`/p/${productId}`}>{product.name}</Link> / <span>添加资料</span>
      </nav>
      <h1>添加资料</h1>
      <p className="muted">
        支持 UTF-8 的 TXT / Markdown 或直接粘贴文字。单文件不超过 2 MB、100,000 字符，一次最多 10 个文件。内容相同的资料会复用，不会重复保存；上传不会调用 AI。
      </p>
      <section className="card">
        <h2>聊天截图</h2>
        <ScreenshotUploadForm action={uploadImagesAction} productId={productId} />
      </section>
      <section className="card">
        <h2>文字资料</h2>
        <Form
          action={addSourcesAction}
          submit="保存"
          fields={[
            { name: "productId", type: "hidden", defaultValue: productId },
            { name: "files", label: "上传文件", type: "file", multiple: true, accept: ".txt,.md,.markdown,text/plain,text/markdown" },
            { name: "name", label: "粘贴资料的名称", type: "text", placeholder: "例如：权限规则说明" },
            { name: "text", label: "或粘贴文字", type: "textarea", rows: 12, mono: true },
            { name: "originalUrl", label: "原始链接（只作记录，不会访问）", type: "text" },
          ]}
        />
      </section>
    </>
  );
}
