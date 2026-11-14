export const TASK_LABEL: Record<string, string> = {
  abstraction: "Request abstraction",
  split_requests: "Request split",
  transcribe_image: "Screenshot reading",
};

export const RUN_STATUS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Canceled",
  interrupted: "Interrupted",
};

/** What the user can do about each failure (§6.3). */
export const FAILURE_HINT: Record<string, string> = {
  auth: "Check the model key under Settings.",
  model_not_found: "Check the model ID under Settings.",
  network: "Check your network and the endpoint, then retry.",
  rate_limited: "Retry later, or check your account's quota.",
  invalid_output: "The model's result failed the citation and completeness checks, so no claims were added. Retry, or switch to a more capable model.",
  outcome_unknown: "The request timed out. The provider may already have run and billed it, so retrying may cost extra.",
  interrupted: "The server restarted while this task was running, so the outcome is unknown. Retrying may cost extra.",
  truncated: "Raise the output limit under Settings, then retry.",
  refused: "Adjust the selected material, then retry.",
  unsupported_format: "This model or service may not support structured output or image input.",
};
