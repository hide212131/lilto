export type Logger = {
  info: (message: string, payload?: unknown) => void;
  error: (message: string, payload?: unknown) => void;
};

function formatPayload(payload: unknown): string {
  if (payload === undefined) return "";
  try {
    return ` ${JSON.stringify(payload)}`;
  } catch {
    return " [unserializable]";
  }
}

export function createLogger(namespace: string): Logger {
  return {
    info(message, payload) {
      console.log(`[${namespace}] ${message}${formatPayload(payload)}`);
    },
    error(message, payload) {
      console.error(`[${namespace}] ${message}${formatPayload(payload)}`);
    }
  };
}
