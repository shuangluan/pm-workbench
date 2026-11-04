import { instanceStatus } from "@pew/db";
import { redirect } from "next/navigation";
import { loginAction, setupAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { isSignedIn } from "@/lib/auth";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const status = await instanceStatus(await getDb(), config.dataDir);
  if (status.initialized && !status.setupPending && (await isSignedIn())) redirect("/");

  return (
    <main className="auth">
      <h1>PM Evidence Workbench</h1>
      <p className="muted">本地单人版 · 只在本机访问</p>
      {status.setupPending ? (
        <section className="card">
          <h2>{status.initialized ? "重置访问口令" : "初始化实例"}</h2>
          <p>输入终端显示的一次性初始化码，并设置访问口令。完成后初始化码失效，所有旧会话退出。</p>
          <Form
            action={setupAction}
            submit="完成设置"
            fields={[
              { name: "code", label: "初始化码", type: "text", required: true, autoComplete: "one-time-code", placeholder: "XXXX-XXXX-XXXX-XXXX" },
              { name: "passphrase", label: "访问口令（至少 10 个字符）", type: "password", required: true, autoComplete: "new-password" },
              { name: "passphrase2", label: "再次输入访问口令", type: "password", required: true, autoComplete: "new-password" },
            ]}
          />
        </section>
      ) : status.initialized ? (
        <section className="card">
          <h2>登录</h2>
          <Form
            action={loginAction}
            submit="登录"
            fields={[{ name: "passphrase", label: "访问口令", type: "password", required: true, autoComplete: "current-password" }]}
          />
          <p className="help">忘记口令：在项目目录运行 <code>npm run access:reset</code>，再刷新本页。</p>
        </section>
      ) : (
        <section className="card">
          <h2>尚未初始化</h2>
          <p>初始化码已显示在启动服务的终端里。如果没有看到（例如在 Docker 中运行），在项目目录运行下面的命令，然后刷新本页：</p>
          <pre>npm run access:reset</pre>
          <p className="help">初始化码只显示在终端，不写入日志，30 分钟内有效。</p>
        </section>
      )}
    </main>
  );
}
