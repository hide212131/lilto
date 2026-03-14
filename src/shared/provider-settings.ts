export type ActiveProvider = "oauth" | "custom-openai-completions";
export const OAUTH_PROVIDER_IDS = [
  "openai-codex"
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

export type WindowsSandboxMode = "off" | "unelevated" | "elevated";

export type WindowsSandboxSettings = {
  mode: WindowsSandboxMode;
  privateDesktop: boolean;
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
  oauthModelId: string;
  customProvider: CustomProviderSettings;
  networkProxy: NetworkProxySettings;
  windowsSandbox: WindowsSandboxSettings;
  chatSettings: ChatSettings;
  updatedAt: number;
};

export const DEFAULT_NETWORK_PROXY_SETTINGS: NetworkProxySettings = {
  useProxy: false
};

export const DEFAULT_WINDOWS_SANDBOX_SETTINGS: WindowsSandboxSettings = {
  mode: "off",
  privateDesktop: true
};
