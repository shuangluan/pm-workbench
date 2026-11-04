# PM Evidence Workbench (working title)

**English** | [简体中文](README.zh-CN.md)

Helps platform and B2B product managers turn requests from many stakeholders into a shared capability proposal grounded in the original wording, and lists the system impacts, conflicts and unknowns that still need checking. Runs locally for a single user, with your own model account.

> **Status: M2 preview.** Quick start (paste chat logs, tables or screenshots, plus source documents) → generate an abstraction with your own model, or add claims by hand → review each claim → save a report version with suggested next steps → export Markdown or a product ZIP. The whole flow also works by hand without a model.
>
> **The model path has only been tested with a mock server and local tests. It has not been evaluated with a real model, so analysis quality is unknown.** Impact inference and the local memory pages are planned for M3.

> **Language:** the web interface and error messages are currently **Chinese only**. Report headings can be switched to English, and model output follows the language of your source material, although the prompts themselves are in Chinese and English material has not been tested.

## Run locally (no Docker needed)

Requires Node.js 22 or later. Data is stored in `.data/` at the project root, using embedded Postgres (PGlite).

```bash
npm install
```

```bash
npm run dev
```

The server listens only on `http://127.0.0.1:3210`. On first start, the terminal shows a one-time setup code before the server comes up. Open `http://127.0.0.1:3210/login`, enter the code and choose a passphrase. Then start a quick analysis, or look at the example first.

If you did not see a code (for example, output was redirected) or you forgot your passphrase, run the command below. With a custom `PEW_DATA_DIR`, the login page shows the full command including the directory.

```bash
npm run access:reset
```

Production mode:

```bash
npm run build && npm start
```

## Docker Compose (not yet run)

`compose.yaml` uses Postgres 17, binds the web port to `127.0.0.1:3210` on the host and publishes no database port. **This setup has not been run yet.** The pinned image tags have been confirmed to exist.

```bash
cp .env.example .env
```

Set `PEW_DB_PASSWORD` in `.env`, then:

```bash
docker compose up --build
```

```bash
docker compose exec web npm run access:reset
```

Do not expose this service to a LAN or the internet: it has no TLS and no multi-user permissions.

## Where your data goes

- All sources, requests, claims and reports are stored on your machine (`.data/` or the Compose volumes).
- Only when you start a task are the selected requests, source excerpts or original screenshots sent to the model service you configured. The page lists what will be sent and where before it runs. That content is then subject to the provider's terms, so "runs locally" does not mean "data never leaves your machine" unless your model is local too.
- Model API keys are stored encrypted and are not included in product exports.
- No telemetry, no automatic update checks, and links in your sources are never fetched.

## Trying it without a model key

Start the local mock model, which costs nothing and exits on its own after 20 minutes:

```bash
npm run mock-model
```

Then, under 设置与诊断 (Settings and diagnostics), choose the OpenAI-compatible interface, set the endpoint to `http://127.0.0.1:11555/v1`, enable local model mode and enter any key. Its output is fixed synthetic text marked 【模拟】 ("simulated"), useful for walking through the flow but not for judging analysis quality.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server (127.0.0.1:3210) |
| `npm run build` / `npm start` | Production build and start |
| `npm run access:reset` | Issue a one-time setup code; all signed-in sessions end immediately |
| `npm run doctor` | Check Node, data directory, migrations and database (prints no content) |
| `npm run mock-model` | Local mock model for trying the model flows at no cost |
| `npm run licenses` | Regenerate the third-party license list |
| `npm run check` | Type checks and all tests |
| `npm run db:generate` | Generate a migration after changing the schema |

Backup, restore and upgrade steps are in [docs/recovery.md](docs/recovery.md) (Chinese).

## What exists today

| Area | Location |
| --- | --- |
| Evidence location, citation checks, dependency graph query, review, report and spec rendering | `packages/core` |
| Postgres schema and migrations; composite foreign keys reject cross-product references in the database | `packages/db/src/schema.ts`, `migrations/` |
| Local access: one-time setup codes, scrypt passphrase, hashed sessions, immediate invalidation on reset | `packages/db/src/access.ts`, `scripts/` |
| Products, versioned sources, verbatim requests, analysis scope, permanent deletion that scrubs saved reports | `packages/db/src/services` |
| Claims written by hand, validated like model output; accept, correct and reject with optimistic locking | `packages/db/src/services/claims.ts` |
| Immutable report versions; Markdown report and spec summary with Chinese or English headings | `packages/db/src/services/reports.ts` |
| Product ZIP export and import: checksums, content hashes, path and size limits, full id remapping | `packages/db/src/services/portability.ts` |
| Web workbench: products, source viewer with line numbers and citation highlights, requests, three-step analysis page, reports, import, diagnostics | `apps/web` |
| Loopback only, Host checks, cross-site write rejection, HttpOnly and SameSite=Strict sessions | `apps/web/proxy.ts` |
| Quick start: one page creates the product, sources, requests and an analysis with its scope selected | `apps/web/app/(app)/start`, `packages/db/src/services/quickstart.ts` |
| Rule-based splitting of tables, chat logs, "party: text" lines, lists and paragraphs; CSV import | `packages/core/src/split.ts` |
| Chat screenshots: paste, drop or pick; stored originals with dedupe; versioned transcripts linked to the image | `packages/db/src/services/media.ts` |
| Select text in a source to cite it or add a claim based on it | `apps/web/components/SelectToCite.tsx` |
| Suggested next steps in reports; confirmed dependency check | `packages/core/src/report.ts`, `packages/db/src/services/memory.ts` |
| Model access: Anthropic and OpenAI-compatible adapters, encrypted keys, endpoint safety checks, connection test | `packages/model-adapters`, `packages/db/src/services/models.ts` |
| Durable run queue: frozen inputs, idempotency, cancel, interruption recovery, at most one automatic retry, usage recorded per attempt | `packages/db/src/services/runs.ts`, `packages/db/src/services/worker.ts` |
| Abstraction, screenshot reading and model splitting; output that fails validation never becomes claims | `packages/core/src/tasks.ts` |

## Not done yet

- **Rest of M2:** evaluation set and validation with a real model (M2's exit criterion, not yet met), daily token soft budget.
- **M3:** local memory pages for confirming nodes and relations, impact check page (the graph query itself is done), impact inference.
- English web interface.
- Whole-instance backup and restore scripts (manual steps for now), keeping original text uploads (only normalized text is stored; screenshots keep the original), deleting requests, narrow-screen evidence drawer, duplicate hints during bulk entry.
- `CHANGELOG`.

## Known limitations

- PGlite allows one process per data directory. While the server runs, `npm run doctor` skips the database check. `access:reset` does not touch the database and can run at any time.
- Character offsets are UTF-16 code units; character limits count code points.
- The moderate findings from `npm audit` are all in development dependencies (vitest and the esbuild used by drizzle-kit).

Changes from the original product spec are recorded in [docs/scope-changes.md](docs/scope-changes.md) (Chinese).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

[AGPL-3.0-only](LICENSE). You are free to use, modify and deploy this software. If you offer a modified version to others as a network service, you must make the corresponding source code available to those users. Third-party dependencies are listed in [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md).
