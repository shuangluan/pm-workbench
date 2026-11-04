# Security policy

**English** | [简体中文](SECURITY.zh-CN.md)

## Reporting a vulnerability

**Please do not report security vulnerabilities in public issues.**

Use **Report a vulnerability** on the repository's **Security** tab to report privately. Describe the impact, the steps to reproduce and the affected version, and do not include real keys or customer data. If that option is not available, open an issue asking for a private contact, without any details of the problem.

This is a preview project maintained in spare time. There is no guaranteed response time and no bug bounty. The maintainer will do their best to confirm and fix issues, and will credit you after a fix is released if you wish.

## Supported versions

The project is in preview. Only the latest version of the `main` branch receives fixes; nothing is backported.

## Security model

This tool is designed for **one person running it on their own computer**, with the browser accessing only the local machine.

| Protected against | How |
| --- | --- |
| Other websites driving the local service | Listens only on `127.0.0.1`, checks Host, checks Origin on writes, uses `SameSite=Strict` cookies |
| Passphrase and session leaks | scrypt-hashed passphrase, only session hashes stored, HttpOnly cookies, old sessions end immediately on CLI reset |
| Model key leaks | AES-256-GCM at rest, never shown again, excluded from product exports and logs |
| Requests sent elsewhere | HTTPS by default, redirects never followed, cloud metadata and link-local addresses refused; HTTP only to this machine and only after explicit opt-in |
| Malicious sources and import files | Sources are treated as data, HTML is escaped in Markdown exports, uploaded images are identified by content and SVG is refused, ZIP import checks paths, sizes, file counts and hashes |
| Prompt injection in sources | The model has no tools and cannot read or write files, run commands or send messages; source text is kept in a data section, apart from instructions |
| Models inventing sources | Citation handles are assigned by the server, and output that fails validation never becomes a claim |

## Out of scope

- **LAN or internet deployment.** This tool has no TLS, multi-user permissions or auditing. Exposing it beyond the local machine is unsupported.
- **Malware or other users on the same machine.** Any process that can read the data directory can read your sources and the master key.
- **How model providers handle data.** When you run a task, the selected content, including original screenshots, is sent to the provider you configured and is subject to its privacy terms.
- **The effect of prompt injection on analysis quality.** Malicious text in a source can still mislead the model's conclusions. This is one reason every claim needs human review: validation proves a citation is real, not that a conclusion is correct.
- **Forensic deletion.** Permanent deletion removes what this tool stores. It does not promise disk-level erasure and does not affect files already exported or old backups.

## Recommendations

- Only process material you are allowed to process.
- `.data/` contains `master.key`, so treat backups of it as sensitive.
- Do not commit `.env` or `.data/`.
