import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "./logger";
import type { BashPolicyAppConfig, BashPolicyLoadErrorMode } from "./config";

export type BashPolicyDecision = "deny" | "confirm" | "allow" | "audit";

export type BashPolicyRule = {
  id: string;
  effect: BashPolicyDecision;
  match: {
    type: "regex";
    pattern: string;
    flags?: string;
  };
};

export type BashPolicyDocument = {
  default: BashPolicyDecision;
  nonInteractiveDefault: "confirm" | "deny";
  explain: boolean;
  protectedPaths: string[];
  rules: BashPolicyRule[];
};

export type BashPolicyEvaluation = {
  decision: BashPolicyDecision;
  ruleId: string | null;
  reason: string;
  matchedText: string | null;
  requiresConfirmation: boolean;
  shouldAudit: boolean;
  loadError: string | null;
};

type LoadedPolicy = {
  policy: BashPolicyDocument;
  loadError: string | null;
};

const DECISIONS: BashPolicyDecision[] = ["deny", "confirm", "allow", "audit"];
const DEFAULT_POLICY: BashPolicyDocument = {
  default: "confirm",
  nonInteractiveDefault: "deny",
  explain: true,
  protectedPaths: [".env", ".env.*", "~/.ssh/**", "**/node_modules/**"],
  rules: [
    {
      id: "deny-destructive-rm",
      effect: "deny",
      match: { type: "regex", pattern: "\\brm\\s+-rf\\b", flags: "i" }
    },
    {
      id: "deny-sudo",
      effect: "deny",
      match: { type: "regex", pattern: "\\bsudo\\b", flags: "i" }
    },
    {
      id: "deny-world-writable",
      effect: "deny",
      match: { type: "regex", pattern: "\\b(?:chmod|chown)\\b[^\\n]*\\b777\\b", flags: "i" }
    },
    {
      id: "confirm-git-push",
      effect: "confirm",
      match: { type: "regex", pattern: "\\bgit\\s+push\\b", flags: "i" }
    },
    {
      id: "confirm-publish-or-apply",
      effect: "confirm",
      match: {
        type: "regex",
        pattern: "\\b(?:npm\\s+publish|docker\\s+push|kubectl\\s+apply|terraform\\s+apply)\\b",
        flags: "i"
      }
    },
    {
      id: "allow-readonly-basic",
      effect: "allow",
      match: { type: "regex", pattern: "^\\s*(?:ls|pwd|cat|grep|find|head|tail|wc)\\b", flags: "i" }
    },
    {
      id: "allow-git-readonly",
      effect: "allow",
      match: { type: "regex", pattern: "^\\s*git\\s+(?:status|diff|log)\\b", flags: "i" }
    }
  ]
};

function cloneDefaultPolicy(): BashPolicyDocument {
  return {
    default: DEFAULT_POLICY.default,
    nonInteractiveDefault: DEFAULT_POLICY.nonInteractiveDefault,
    explain: DEFAULT_POLICY.explain,
    protectedPaths: [...DEFAULT_POLICY.protectedPaths],
    rules: DEFAULT_POLICY.rules.map((rule) => ({
      id: rule.id,
      effect: rule.effect,
      match: { ...rule.match }
    }))
  };
}

function stripInlineComment(line: string): string {
  let quoted: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quoted = quoted === char ? null : quoted ?? char;
      continue;
    }
    if (char === "#" && quoted === null) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

type YamlLine = { indent: number; value: string };

function toYamlLines(text: string): YamlLine[] {
  return text
    .split(/\r?\n/)
    .map((raw) => stripInlineComment(raw))
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      indent: line.match(/^ */)?.[0].length ?? 0,
      value: line.trim()
    }));
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed.length) return "";
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseYamlBlock(lines: YamlLine[], startIndex: number, indent: number): [unknown, number] {
  if (startIndex >= lines.length) {
    return [{}, startIndex];
  }

  const startsArray = lines[startIndex].indent === indent && lines[startIndex].value.startsWith("- ");
  if (startsArray) {
    const items: unknown[] = [];
    let index = startIndex;
    while (index < lines.length && lines[index].indent === indent && lines[index].value.startsWith("- ")) {
      const inline = lines[index].value.slice(2).trim();
      if (!inline.length) {
        const [child, nextIndex] = parseYamlBlock(lines, index + 1, indent + 2);
        items.push(child);
        index = nextIndex;
        continue;
      }

      if (/^[^:]+:\s*/.test(inline)) {
        const item: Record<string, unknown> = {};
        const separator = inline.indexOf(":");
        const key = inline.slice(0, separator).trim();
        const remainder = inline.slice(separator + 1).trim();
        if (remainder.length > 0) {
          item[key] = parseScalar(remainder);
          index += 1;
        } else {
          const [child, nextIndex] = parseYamlBlock(lines, index + 1, indent + 2);
          item[key] = child;
          index = nextIndex;
        }

        while (index < lines.length && lines[index].indent === indent + 2 && !lines[index].value.startsWith("- ")) {
          const separatorIndex = lines[index].value.indexOf(":");
          if (separatorIndex < 0) {
            throw new Error(`Invalid YAML line: ${lines[index].value}`);
          }
          const childKey = lines[index].value.slice(0, separatorIndex).trim();
          const childRemainder = lines[index].value.slice(separatorIndex + 1).trim();
          if (childRemainder.length > 0) {
            item[childKey] = parseScalar(childRemainder);
            index += 1;
          } else {
            const [child, nextIndex] = parseYamlBlock(lines, index + 1, indent + 4);
            item[childKey] = child;
            index = nextIndex;
          }
        }

        items.push(item);
        continue;
      }

      items.push(parseScalar(inline));
      index += 1;
    }
    return [items, index];
  }

  const objectValue: Record<string, unknown> = {};
  let index = startIndex;
  while (index < lines.length && lines[index].indent === indent) {
    const separatorIndex = lines[index].value.indexOf(":");
    if (separatorIndex < 0) {
      throw new Error(`Invalid YAML line: ${lines[index].value}`);
    }
    const key = lines[index].value.slice(0, separatorIndex).trim();
    const remainder = lines[index].value.slice(separatorIndex + 1).trim();
    if (remainder.length > 0) {
      objectValue[key] = parseScalar(remainder);
      index += 1;
      continue;
    }
    const [child, nextIndex] = parseYamlBlock(lines, index + 1, indent + 2);
    objectValue[key] = child;
    index = nextIndex;
  }
  return [objectValue, index];
}

function parseYamlDocument(text: string): Record<string, unknown> {
  const lines = toYamlLines(text);
  if (lines.length === 0) {
    return {};
  }
  const [parsed] = parseYamlBlock(lines, 0, 0);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML root must be an object");
  }
  return parsed as Record<string, unknown>;
}

function validateRule(raw: unknown): BashPolicyRule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("rule must be an object");
  }
  const rule = raw as Record<string, unknown>;
  if (typeof rule.id !== "string" || !rule.id.trim()) {
    throw new Error("rule.id is required");
  }
  if (typeof rule.effect !== "string" || !DECISIONS.includes(rule.effect as BashPolicyDecision)) {
    throw new Error(`rule.effect must be one of ${DECISIONS.join(", ")}`);
  }
  if (!rule.match || typeof rule.match !== "object" || Array.isArray(rule.match)) {
    throw new Error("rule.match is required");
  }
  const match = rule.match as Record<string, unknown>;
  if (match.type !== "regex" || typeof match.pattern !== "string" || !match.pattern.length) {
    throw new Error("rule.match.type must be regex and pattern is required");
  }
  if (typeof match.flags === "string") {
    void new RegExp(match.pattern, match.flags);
  } else {
    void new RegExp(match.pattern, "i");
  }
  return {
    id: rule.id,
    effect: rule.effect as BashPolicyDecision,
    match: {
      type: "regex",
      pattern: match.pattern,
      flags: typeof match.flags === "string" ? match.flags : "i"
    }
  };
}

function validatePolicyDocument(raw: Record<string, unknown>): BashPolicyDocument {
  const fallback = cloneDefaultPolicy();
  const policyDefault =
    typeof raw.default === "string" && DECISIONS.includes(raw.default as BashPolicyDecision)
      ? (raw.default as BashPolicyDecision)
      : fallback.default;
  const nonInteractiveDefault =
    raw.nonInteractiveDefault === "deny" || raw.nonInteractiveDefault === "confirm"
      ? raw.nonInteractiveDefault
      : fallback.nonInteractiveDefault;
  const explain = typeof raw.explain === "boolean" ? raw.explain : fallback.explain;
  const protectedPaths = Array.isArray(raw.protectedPaths)
    ? raw.protectedPaths.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : fallback.protectedPaths;
  const rules = Array.isArray(raw.rules) ? raw.rules.map(validateRule) : fallback.rules;

  return {
    default: policyDefault,
    nonInteractiveDefault,
    explain,
    protectedPaths,
    rules
  };
}

export function loadBashPolicy(config: BashPolicyAppConfig): LoadedPolicy {
  if (!existsSync(config.policyPath)) {
    return { policy: cloneDefaultPolicy(), loadError: null };
  }

  try {
    const document = readFileSync(config.policyPath, "utf8");
    const parsed = parseYamlDocument(document);
    return {
      policy: validatePolicyDocument(parsed),
      loadError: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      policy: {
        default: config.loadErrorMode,
        nonInteractiveDefault: "deny",
        explain: true,
        protectedPaths: [],
        rules: []
      },
      loadError: `bash policy load failed: ${message}`
    };
  }
}

export function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if ((char === "'" || char === '"') && command[index - 1] !== "\\") {
      if (quote === char) {
        quote = null;
      } else if (quote === null) {
        quote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === null && /\s/.test(char)) {
      if (current.length) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length) {
    tokens.push(current);
  }

  return tokens;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += ".";
      continue;
    }
    if (/[|\\{}()[\]^$+?.]/.test(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  source += "$";
  return new RegExp(source, "i");
}

function isPotentiallyDestructive(command: string): boolean {
  return /(?:^|[;&|]\s*)\b(?:rm|mv|cp|chmod|chown|tee|truncate|dd|mkfs|sed)\b|(^|[^<])>>?|xargs\b/i.test(command);
}

function extractPotentialPaths(command: string, cwd: string): string[] {
  const tokens = tokenizeCommand(command);
  const values: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === ">" || token === ">>") {
      const target = tokens[index + 1];
      if (target) values.push(target);
      continue;
    }
    if (token.startsWith(">") || token.startsWith(">>")) {
      values.push(token.replace(/^>>?/, ""));
      continue;
    }
    values.push(token);
  }

  const normalized = new Set<string>();
  for (const rawValue of values) {
    const value = unquote(rawValue);
    if (!value || value === "|" || value === "&&" || value === ";" || value === "xargs") {
      continue;
    }
    const candidate = value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
    const absolute = resolved.replace(/\\/g, "/");
    const relative = path.relative(cwd, resolved).replace(/\\/g, "/");
    normalized.add(absolute);
    normalized.add(relative);
    normalized.add(path.basename(candidate).replace(/\\/g, "/"));
    normalized.add(candidate.replace(/\\/g, "/"));
  }
  return [...normalized];
}

function matchProtectedPath(command: string, policy: BashPolicyDocument, cwd: string): string | null {
  if (!policy.protectedPaths.length || !isPotentiallyDestructive(command)) {
    return null;
  }

  const candidates = extractPotentialPaths(command, cwd);
  for (const rawPattern of policy.protectedPaths) {
    const pattern = rawPattern.startsWith("~") ? path.join(os.homedir(), rawPattern.slice(1)) : rawPattern;
    const regex = globToRegExp(pattern.replace(/\\/g, "/"));
    if (candidates.some((candidate) => regex.test(candidate))) {
      return rawPattern;
    }
  }
  return null;
}

export function evaluateBashCommand(command: string, policy: BashPolicyDocument, cwd: string): BashPolicyEvaluation {
  const protectedPath = matchProtectedPath(command, policy, cwd);
  if (protectedPath) {
    return {
      decision: "deny",
      ruleId: "protected-path",
      reason: `保護対象パス ${protectedPath} への破壊的操作を検出したため拒否しました。`,
      matchedText: protectedPath,
      requiresConfirmation: false,
      shouldAudit: true,
      loadError: null
    };
  }

  const normalized = normalizeCommand(command);
  for (const effect of ["deny", "confirm", "allow", "audit"] as BashPolicyDecision[]) {
    for (const rule of policy.rules) {
      if (rule.effect !== effect) continue;
      const matcher = new RegExp(rule.match.pattern, rule.match.flags ?? "i");
      const matched = normalized.match(matcher);
      if (!matched) continue;
      return {
        decision: effect,
        ruleId: rule.id,
        reason: `ルール ${rule.id} に一致しました。`,
        matchedText: matched[0] ?? null,
        requiresConfirmation: effect === "confirm",
        shouldAudit: effect === "audit" || effect === "confirm" || effect === "deny",
        loadError: null
      };
    }
  }

  return {
    decision: policy.default,
    ruleId: null,
    reason: "明示ルールに一致しなかったため既定ポリシーを適用しました。",
    matchedText: null,
    requiresConfirmation: policy.default === "confirm",
    shouldAudit: policy.default === "audit",
    loadError: null
  };
}

export function evaluateBashAgainstConfig(options: {
  command: string;
  cwd: string;
  config: BashPolicyAppConfig;
}): BashPolicyEvaluation {
  const loaded = loadBashPolicy(options.config);
  const evaluation = evaluateBashCommand(options.command, loaded.policy, options.cwd);
  if (loaded.loadError) {
    return {
      ...evaluation,
      decision: options.config.loadErrorMode,
      requiresConfirmation: options.config.loadErrorMode === "confirm",
      shouldAudit: true,
      loadError: loaded.loadError,
      reason: loaded.loadError
    };
  }
  return evaluation;
}

function appendAuditLog(config: BashPolicyAppConfig, entry: Record<string, unknown>): void {
  mkdirSync(path.dirname(config.auditLogPath), { recursive: true });
  appendFileSync(config.auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function buildAuditEntry(options: {
  config: BashPolicyAppConfig;
  cwd: string;
  command: string;
  evaluation: BashPolicyEvaluation;
  approved: boolean | null;
}): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    cwd: options.cwd,
    tool: "bash",
    command: options.command,
    decision: options.evaluation.decision,
    ruleId: options.evaluation.ruleId,
    approved: options.approved,
    reason: options.evaluation.reason,
    loadError: options.evaluation.loadError
  };
}

export function createBashPolicyGateExtension(options: {
  config: BashPolicyAppConfig;
  logger: Logger;
}): (pi: any) => void {
  return (pi: any) => {
    pi.on("tool_call", async (event: any, ctx: any) => {
      if (event.toolName !== "bash") {
        return undefined;
      }

      const command = typeof event.input?.command === "string" ? event.input.command : "";
      const evaluation = evaluateBashAgainstConfig({
        command,
        cwd: ctx.cwd,
        config: options.config
      });

      const shouldLog = evaluation.shouldAudit || evaluation.decision === "deny" || evaluation.decision === "confirm";
      const writeAudit = (approved: boolean | null) => {
        if (!shouldLog) return;
        appendAuditLog(
          options.config,
          buildAuditEntry({
            config: options.config,
            cwd: ctx.cwd,
            command,
            evaluation,
            approved
          })
        );
      };

      if (evaluation.decision === "allow" || evaluation.decision === "audit") {
        writeAudit(evaluation.decision === "audit" ? true : null);
        return undefined;
      }

      if (evaluation.decision === "deny") {
        writeAudit(false);
        return {
          block: true,
          reason: evaluation.reason
        };
      }

      if (!ctx.hasUI) {
        writeAudit(false);
        return {
          block: true,
          reason: `${evaluation.reason} UI がないため確認できません。`
        };
      }

      const approved = await ctx.ui.confirm(
        "Bash 実行の確認",
        `コマンド: ${command}\n理由: ${evaluation.reason}${evaluation.ruleId ? `\nルール: ${evaluation.ruleId}` : ""}`
      );
      writeAudit(approved);
      if (!approved) {
        options.logger.info("bash_policy_blocked", {
          command,
          decision: evaluation.decision,
          ruleId: evaluation.ruleId
        });
        return {
          block: true,
          reason: "Bash 実行は利用者により拒否されました。"
        };
      }

      options.logger.info("bash_policy_confirmed", {
        command,
        ruleId: evaluation.ruleId
      });
      return undefined;
    });
  };
}

export function createTestPolicyConfig(baseDir: string, loadErrorMode: BashPolicyLoadErrorMode = "confirm"): BashPolicyAppConfig {
  return {
    policyPath: path.join(baseDir, "bash-policy.yaml"),
    auditLogPath: path.join(baseDir, "bash-policy.jsonl"),
    loadErrorMode
  };
}
