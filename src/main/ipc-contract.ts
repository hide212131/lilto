export type PromptPayload = { text: string };
// 既存 submitPrompt の request/response 契約は維持し、loop event は別チャネルで追加する。
export const AGENT_LOOP_EVENT_CHANNEL = "agent:loopEvent";

export type PromptValidationError = {
  ok: false;
  code: "INVALID_REQUEST" | "EMPTY_PROMPT";
  message: string;
};

export type PromptValidationOk = { ok: true };
export type PromptValidationResult = PromptValidationOk | PromptValidationError;

export function validatePrompt(payload: unknown): PromptValidationResult {
  if (!payload || typeof payload !== "object" || typeof (payload as Record<string, unknown>).text !== "string") {
    return { ok: false, code: "INVALID_REQUEST", message: "text は必須です" };
  }

  const text = (payload as Record<string, string>).text;
  if (!text.trim()) {
    return { ok: false, code: "EMPTY_PROMPT", message: "text が空です" };
  }

  return { ok: true };
}
