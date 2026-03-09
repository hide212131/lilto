import path from "node:path";

export type AppConfig = {
  heartbeatIntervalMs: number;
  appName: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    heartbeatIntervalMs: Number(env.LILTO_HEARTBEAT_INTERVAL_MS || 600000),
    appName: env.LILTO_APP_NAME || "Lilt-o"
  };
}

export type BashPolicyLoadErrorMode = "confirm" | "deny";

export type BashPolicyAppConfig = {
  policyPath: string;
  auditLogPath: string;
  loadErrorMode: BashPolicyLoadErrorMode;
};

export function resolveBashPolicyConfig(options: {
  appDataDir: string;
  env?: NodeJS.ProcessEnv;
}): BashPolicyAppConfig {
  const env = options.env ?? process.env;
  const policyPath = env.LILTO_BASH_POLICY_PATH?.trim() || path.join(options.appDataDir, "bash-policy.yaml");
  const auditLogPath =
    env.LILTO_BASH_POLICY_AUDIT_LOG_PATH?.trim() || path.join(options.appDataDir, "logs", "bash-policy.jsonl");
  const loadErrorMode = env.LILTO_BASH_POLICY_LOAD_ERROR_MODE === "deny" ? "deny" : "confirm";

  return {
    policyPath,
    auditLogPath,
    loadErrorMode
  };
}
