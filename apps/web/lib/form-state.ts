export interface FormState {
  seq: number;
  error?: string;
  ok?: string;
  /** Submitted values, echoed back on error so typed text is not lost. */
  values?: Record<string, string | string[]>;
}

export const initialFormState: FormState = { seq: 0 };
