export type ActiveProvider = "claude" | "custom-openai-completions";

export type CustomProviderSettings = {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
};

export type NetworkProxySettings = {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
};

export type ProviderSettings = {
  activeProvider: ActiveProvider;
  customProvider: CustomProviderSettings;
  networkProxy: NetworkProxySettings;
  updatedAt: number;
};

export const DEFAULT_NETWORK_PROXY_SETTINGS: NetworkProxySettings = {
  httpProxy: "",
  httpsProxy: "",
  noProxy: ""
};
