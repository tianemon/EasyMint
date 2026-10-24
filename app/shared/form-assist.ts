export const FORM_ASSIST_KINDS = ["directory-name", "features"] as const;
export type FormAssistKind = typeof FORM_ASSIST_KINDS[number];

export interface FormAssistRequest {
  requestId: string;
  kind: FormAssistKind;
  prompt: string;
}
