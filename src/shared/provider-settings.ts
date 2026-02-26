export type ActiveProvider = "claude" | "custom-openai-completions";
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

export type ProviderSettings = {
  activeProvider: ActiveProvider;
  oauthProvider: OAuthProviderId;
  customProvider: CustomProviderSettings;
  networkProxy: NetworkProxySettings;
  updatedAt: number;
};

export const DEFAULT_NETWORK_PROXY_SETTINGS: NetworkProxySettings = {
  useProxy: false
};
