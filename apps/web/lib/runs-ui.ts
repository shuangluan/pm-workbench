export const TASK_LABEL: Record<string, string> = {
  abstraction: "需求抽象",
  split_requests: "需求拆分",
  transcribe_image: "读取截图",
};

export const RUN_STATUS: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
  canceled: "已取消",
  interrupted: "已中断",
};

/** What the user can do about each failure (§6.3). */
export const FAILURE_HINT: Record<string, string> = {
  auth: "请到“设置与诊断”检查模型密钥。",
  model_not_found: "请到“设置与诊断”检查模型 ID。",
  network: "请检查网络和端点地址后重试。",
  rate_limited: "请稍后重试，或检查账户额度。",
  invalid_output: "模型的结果没有通过引用和完整性校验，未进入条目。可以重试，或换一个能力更强的模型。",
  outcome_unknown: "请求超时，模型服务可能已经执行并计费。重试可能产生额外费用。",
  interrupted: "服务重启时任务还在运行，结果未知。重试可能产生额外费用。",
  truncated: "请到“设置与诊断”调高输出上限后重试。",
  refused: "可以调整资料范围后重试。",
  unsupported_format: "这个模型或服务可能不支持结构化输出或图片输入。",
};
