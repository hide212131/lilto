export type AppConfig = {
  heartbeatIntervalMs: number;
  appName: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    heartbeatIntervalMs: Number(env.LILT_HEARTBEAT_INTERVAL_MS || 15000),
    appName: env.LILT_APP_NAME || "Lilt-AI"
  };
}
