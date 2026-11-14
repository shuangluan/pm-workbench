import { instanceStatus } from "@pew/db";
import { redirect } from "next/navigation";
import { loginAction, setupAction } from "@/app/actions";
import { Form } from "@/components/Form";
import { isSignedIn } from "@/lib/auth";
import { accessResetCommand, config } from "@/lib/config";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const status = await instanceStatus(await getDb(), config.dataDir);
  if (status.initialized && !status.setupPending && (await isSignedIn())) redirect("/");

  return (
    <main className="auth">
      <h1>PM Evidence Workbench</h1>
      <p className="muted">Local, single user · reachable only from this machine</p>
      {status.setupPending ? (
        <section className="card">
          <h2>{status.initialized ? "Reset passphrase" : "Set up this instance"}</h2>
          <p>Enter the one-time setup code shown in your terminal and choose a passphrase. The code then stops working and all earlier sessions are signed out.</p>
          <p className="help">
            Cannot find the code? Run <code>{accessResetCommand()}</code> to get a new one, then come back here.
          </p>
          <Form
            action={setupAction}
            submit="Finish setup"
            fields={[
              { name: "code", label: "Setup code", type: "text", required: true, autoComplete: "one-time-code", placeholder: "XXXX-XXXX-XXXX-XXXX" },
              { name: "passphrase", label: "Passphrase (at least 10 characters)", type: "password", required: true, autoComplete: "new-password" },
              { name: "passphrase2", label: "Repeat passphrase", type: "password", required: true, autoComplete: "new-password" },
            ]}
          />
        </section>
      ) : status.initialized ? (
        <section className="card">
          <h2>Sign in</h2>
          <Form
            action={loginAction}
            submit="Sign in"
            fields={[{ name: "passphrase", label: "Passphrase", type: "password", required: true, autoComplete: "current-password" }]}
          />
          <p className="help">Forgot it? Run <code>{accessResetCommand()}</code> in the project directory, then refresh this page.</p>
        </section>
      ) : (
        <section className="card">
          <h2>Not set up yet</h2>
          <p>Open a terminal in the project directory and run this command to get a one-time setup code, then refresh this page:</p>
          <pre>{accessResetCommand()}</pre>
          <p className="help">The code is shown only in your terminal, never logged, and is valid for 30 minutes.</p>
        </section>
      )}
    </main>
  );
}
