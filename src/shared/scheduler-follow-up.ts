import type { SchedulerNotificationEvent } from "./scheduler";

export type SchedulerNotificationDecision = {
  shouldNotify: boolean;
  userMessage: string;
  role?: "system" | "error";
};

export function shouldRunConditionalSchedulerFollowUp(event: SchedulerNotificationEvent): boolean {
  return Boolean(event.followUpInstruction && event.notificationDecisionCriteria);
}

export function buildConditionalSchedulerFollowUpPrompt(event: SchedulerNotificationEvent): string {
  return [
    "以下はこの会話で発火した scheduler 通知です。",
    `通知文言: ${event.message}`,
    `続きの処理: ${event.followUpInstruction ?? ""}`,
    `通知判断基準: ${event.notificationDecisionCriteria ?? ""}`,
    "この通知はまだユーザーへ表示していません。",
    "まず続きの処理をこの会話で実行してください。",
    "処理完了後は、最後の応答として JSON オブジェクトのみを返してください。前置き、説明、コードブロックは禁止です。",
    '{"shouldNotify":true,"userMessage":"ユーザーへ表示する文面","resultSummary":"内部向けの短い要約"}',
    "`shouldNotify` は boolean にしてください。通知不要なら false を返します。",
    "`userMessage` は shouldNotify=true のときだけユーザーへ見せる短い文面にしてください。",
    "判断基準に照らして通知不要なら shouldNotify=false を返してください。"
  ].join("\n");
}

export function parseSchedulerNotificationDecision(text: string): SchedulerNotificationDecision | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const jsonCandidate = extractJsonObject(trimmed);
  if (!jsonCandidate) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonCandidate) as { shouldNotify?: unknown; userMessage?: unknown };
    if (typeof parsed.shouldNotify !== "boolean") {
      return null;
    }

    const userMessage = typeof parsed.userMessage === "string" ? parsed.userMessage.trim() : "";
    return {
      shouldNotify: parsed.shouldNotify,
      userMessage: userMessage || "スケジュールの処理が完了しました。"
    };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]?.trim();
  if (fenced?.startsWith("{")) {
    return fenced;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
}