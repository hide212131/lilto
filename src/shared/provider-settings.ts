export type ActiveProvider = "oauth" | "custom-openai-completions";
export const OAUTH_PROVIDER_IDS = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
  "google-antigravity"
] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export type CustomProviderSettings = {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
};

export type NetworkProxySettings = {
  useProxy: boolean;
};

export type ToolExecutionSettings = {
  useWindowsIsolatedToolExecution: boolean;
};

export type ChatSettings = {
  enterToSend: boolean;
  globalShortcut: string;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enterToSend: false,
  globalShortcut: "CommandOrControl+L"
};

export type ProviderSettings = {
  activeProvider: ActiveProvider;
  oauthProvider: OAuthProviderId;
  customProvider: CustomProviderSettings;
  networkProxy: NetworkProxySettings;
  toolExecution: ToolExecutionSettings;
  chatSettings: ChatSettings;
  updatedAt: number;
};

export const DEFAULT_NETWORK_PROXY_SETTINGS: NetworkProxySettings = {
  useProxy: false
};

export const DEFAULT_TOOL_EXECUTION_SETTINGS: ToolExecutionSettings = {
  useWindowsIsolatedToolExecution: false
};
