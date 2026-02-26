export type ActiveProvider = "claude" | "custom-openai-completions";

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
  customProvider: CustomProviderSettings;
  networkProxy: NetworkProxySettings;
  updatedAt: number;
};

export const DEFAULT_NETWORK_PROXY_SETTINGS: NetworkProxySettings = {
  useProxy: false
};
