import type { ProviderSettings } from "./provider-settings";
import type { CodexConfig, RuntimeModel, SessionThreadOptions } from "./agent-sdk-types";

export const SCHEDULER_FOLLOW_UP_PROMPT_PREFIX = "以下はこの会話で発火した scheduler 通知です。";
export const AUXILIARY_THREAD_SERVICE_NAME = "lilto-background";

const SCHEDULER_PROMPT_GUIDANCE = [
  "[Scheduler execution rule]",
  "If this request is about reminding/notifying later or on a schedule, you MUST use the `cron` MCP tool.",
  "The `cron` MCP tool is available in this session, so call it directly.",
  "Do not check MCP availability with resource-listing tools before calling `cron`.",
  "Never use sleep, long-running shell commands, background jobs, cron CLI, or polling to wait for time to pass.",
  "Use `set_timer` for relative times like seconds/minutes/hours later.",
  "Use `set_reminder_at` for a specific date/time and `set_daily_reminder` for daily repeats.",
  "After scheduling, briefly confirm what was scheduled."
].join("\n");

const JAPANESE_SCHEDULER_PATTERN =
  /(?:\d+\s*(?:秒|分|時間)後|今日|きょう|明日|あした|毎日|毎週|毎朝|毎晩|\d+\s*時(?:\d+\s*分)?(?:に|から|まで)|リマインド|通知|タイマー|アラーム|おしえて|教えて)/;
const ENGLISH_SCHEDULER_PATTERN =
  /\b(?:remind|reminder|notify|notification|timer|alarm|later|after|tomorrow|today|daily|every day|every week|in \d+\s*(?:second|seconds|minute|minutes|hour|hours))\b/i;

export function buildCustomModel(settings: ProviderSettings): RuntimeModel {
  const modelId = settings.customProvider.modelId.trim();
  const baseUrlInput = settings.customProvider.baseUrl.trim();
  return {
    id: modelId,
    baseUrl: normalizeBaseUrl(baseUrlInput) || undefined
  };
}

export function buildOauthModel(settings: ProviderSettings): RuntimeModel {
  return {
    id: settings.oauthModelId.trim()
  };
}

export function mergeCodexConfig(...configs: Array<CodexConfig | undefined>): CodexConfig | undefined {
  const merged: CodexConfig = {};
  for (const config of configs) {
    if (!config) {
      continue;
    }
    for (const [key, value] of Object.entries(config)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        merged[key] &&
        typeof merged[key] === "object" &&
        !Array.isArray(merged[key])
      ) {
        merged[key] = mergeCodexConfig(merged[key] as CodexConfig, value as CodexConfig) ?? {};
        continue;
      }
      merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function shouldForceCronScheduling(text: string): boolean {
  if (!text.trim()) {
    return false;
  }
  if (text.includes(SCHEDULER_FOLLOW_UP_PROMPT_PREFIX)) {
    return false;
  }
  return JAPANESE_SCHEDULER_PATTERN.test(text) || ENGLISH_SCHEDULER_PATTERN.test(text);
}

export function augmentPromptForScheduler(text: string): string {
  if (!shouldForceCronScheduling(text)) {
    return text;
  }
  return `${text}\n\n${SCHEDULER_PROMPT_GUIDANCE}`;
}

export function buildSessionThreadOptions(settings: ProviderSettings, platform: NodeJS.Platform): SessionThreadOptions {
  if (platform === "win32" && settings.windowsSandbox.mode !== "off") {
    return {
      sandboxMode: "workspace-write",
      config: {
        windows: {
          sandbox: settings.windowsSandbox.mode,
          sandbox_private_desktop: settings.windowsSandbox.privateDesktop
        }
      }
    };
  }

  return {
    sandboxMode: "danger-full-access"
  };
}

export function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    return "";
  }
  try {
    const parsed = new URL(baseUrl);
    const isOllamaHost = (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "11434";
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    if (isOllamaHost && (normalizedPath === "" || normalizedPath === "/")) {
      parsed.pathname = "/v1";
      return parsed.toString().replace(/\/$/, "");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
}

export function isLocalOllamaUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === "11434";
  } catch {
    return false;
  }
}