# Contributing

**English** | [简体中文](CONTRIBUTING.zh-CN.md)

Thank you for helping improve PM Evidence Workbench. This is a preview project maintained in spare time, so responses may be slow.

## What helps most

Preferred contributions:

- bug fixes, ideally with a test that reproduces the problem;
- improvements to report and prompt templates;
- evaluation examples: fully synthetic business scenarios with requests, sources and the expected differences and conflicts;
- documentation fixes.

**Please open an issue before starting a platform integration or a large feature.** The scope is deliberately small, and not every request will be merged. Currently out of scope: multi-user accounts, SSO, Slack, Lark or Jira connectors, automatic message sending, automatic link fetching, vector search and an open plugin system.

## Contribution terms

The project is released under [AGPL-3.0-only](LICENSE). By contributing, you confirm that you have the right to submit the work and agree to release it under the same license.

The exact sign-off for external contributions (DCO or CLA) is **not decided yet**. The maintainer will document it here before merging the first external code, and will ask the relevant pull requests to sign off.

Do not submit real customer data, internal company documents, full text of posts not authorized for publication, or material you have no right to distribute. Examples and test data must be synthetic.

## Local development

Requires Node.js 22 or later. Docker is not needed.

```bash
npm install
```

```bash
npm run dev
```

Before submitting:

```bash
npm run check
```

After changing dependencies, update the license list:

```bash
npm run licenses
```

After changing `packages/db/src/schema.ts`, generate a migration:

```bash
npm run db:generate
```

To work without a real model, start the local mock model. In 设置与诊断 (Settings and diagnostics), set the endpoint to `http://127.0.0.1:11555/v1`, enable local model mode and enter any key:

```bash
npm run mock-model
```

Mock output is fixed synthetic text. It is useful for walking through the flow, not for judging analysis quality.

## Code layout

| Location | Contents |
| --- | --- |
| `packages/core` | Rules with no database or UI dependency: evidence, citation checks, graph query, review, reports, task templates |
| `packages/model-adapters` | The two fixed model adapters and endpoint safety checks |
| `packages/db` | Database schema, business services, run worker |
| `apps/web` | Next.js workbench |
| `apps/worker` | Standalone worker for Postgres deployments |
| `examples` | Synthetic example |

## Rules that must hold

Take special care around these. If a related test fails, do not simply change the test.

- Model output must pass validation before it becomes a claim. Claim type and review status are separate fields: accepting an inference does not make it a fact.
- Citation handles are assigned by the server. A model cannot supply source ids.
- Updating a source creates a new version. Old citations are never silently pointed at a new document.
- Cross-product references are rejected by database foreign keys, not only by service checks.
- Unknown usage stays unknown and is never recorded as 0.
- A failed model call never silently switches model or provider.
- Logs must not contain source text, full prompts or keys.

## Commit messages

Write a one-line summary in the English imperative mood, and explain why in the body. Keep each pull request to one change.

## Security issues

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).
