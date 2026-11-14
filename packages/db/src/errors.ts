// Uniform error shape for the internal API (PRD §7.4): code, message, retryable, details.
// `details` never carries keys, prompts or source text.

export type AppErrorCode =
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "duplicate"
  | "ambiguous"
  | "forbidden"
  | "unauthorized"
  | "not_initialized"
  | "import_rejected";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryable = false,
  ) {
    super(message);
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable, details: this.details };
  }
}

export const notFound = (what: string) => new AppError("not_found", `${what} not found in this product`);

export const revisionConflict = () =>
  new AppError("conflict", "This was changed in another tab or window. Copy your edits, refresh, and try again.");

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
