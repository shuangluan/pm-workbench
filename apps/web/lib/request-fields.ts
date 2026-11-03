import type { Field } from "@/components/Form";

export const REQUEST_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  user: "使用者",
  goal: "目标",
  scenario: "场景",
  workaround: "当前替代方案",
  constraints: "约束",
  timing: "期望时间",
  type: "类型",
  questions: "待澄清问题",
};

export function requestFieldInputs(values: Record<string, string> = {}): Field[] {
  return Object.entries(REQUEST_FIELD_LABELS).map(([name, label]) => ({
    name,
    label,
    type: name === "questions" || name === "constraints" || name === "scenario" ? "textarea" : "text",
    rows: 2,
    defaultValue: values[name] ?? "",
    placeholder: "未知",
  }));
}
