import type { Field } from "@/components/Form";

export const REQUEST_FIELD_LABELS: Record<string, string> = {
  title: "Title",
  user: "Users",
  goal: "Goal",
  scenario: "Scenario",
  workaround: "Current workaround",
  constraints: "Constraints",
  timing: "Expected timing",
  type: "Type",
  questions: "Questions to clarify",
};

export function requestFieldInputs(values: Record<string, string> = {}): Field[] {
  return Object.entries(REQUEST_FIELD_LABELS).map(([name, label]) => ({
    name,
    label,
    type: name === "questions" || name === "constraints" || name === "scenario" ? "textarea" : "text",
    rows: 2,
    defaultValue: values[name] ?? "",
    placeholder: "Unknown",
  }));
}
