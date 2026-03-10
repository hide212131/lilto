import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Logger } from "./logger";

const DEFAULT_TIMEOUT_MS = 120_000;
const WINDOWS_ISOLATION_BASE_DIR = path.join(os.tmpdir(), "lilto-windows-isolated-runs");

type IsolationOperation =
  | { type: "bash"; command: string; cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
  | { type: "write"; path: string; content: string }
  | { type: "read"; path: string }
  | { type: "access"; path: string };

type IsolationOperationResult =
  | { ok: true; exitCode?: number; output?: string; base64?: string }
  | { ok: false; stage?: string; error: string };

type BashOperations = {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    }
  ) => Promise<{ exitCode: number | null }>;
};

type WriteOperations = {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
};

type EditOperations = {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
};

export class WindowsIsolationError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(message: string, options?: { code?: string; stage?: string }) {
    super(message);
    this.name = "WindowsIsolationError";
    this.code = options?.code ?? "WINDOWS_ISOLATION_EXECUTION_FAILED";
    this.stage = options?.stage ?? "execute";
  }
}

export class WindowsIsolatedExecutor {
  constructor(
    private readonly options: {
      workspaceDir: string;
      logger: Logger;
    }
  ) {}

  ensureAvailable(): void {
    if (process.platform !== "win32") {
      throw new WindowsIsolationError("Windows 分離実行は Windows でのみ利用できます。", {
        code: "WINDOWS_ISOLATION_UNAVAILABLE",
        stage: "start"
      });
    }
  }

  createBashOperations(): BashOperations {
    return {
      exec: async (command, cwd, options) => {
        const result = await this.executeOperation({
          type: "bash",
          command,
          cwd: path.resolve(cwd),
          timeoutMs: options.timeout ?? DEFAULT_TIMEOUT_MS,
          env: buildIsolatedEnvironment(options.env)
        });
        if (!result.ok) {
          throw new WindowsIsolationError(result.error, {
            code: "WINDOWS_ISOLATION_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
        if (result.output) {
          options.onData(Buffer.from(result.output, "utf8"));
        }
        return { exitCode: typeof result.exitCode === "number" ? result.exitCode : 1 };
      }
    };
  }

  createWriteOperations(): WriteOperations {
    return {
      mkdir: async () => {
        // write tool creates parent directories during writeFile
      },
      writeFile: async (absolutePath, content) => {
        const result = await this.executeOperation({
          type: "write",
          path: this.toWorkspacePath(absolutePath),
          content
        });
        if (!result.ok) {
          throw new WindowsIsolationError(result.error, {
            code: "WINDOWS_ISOLATION_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
      }
    };
  }

  createEditOperations(): EditOperations {
    return {
      access: async (absolutePath) => {
        const result = await this.executeOperation({
          type: "access",
          path: this.toWorkspacePath(absolutePath)
        });
        if (!result.ok) {
          throw new WindowsIsolationError(result.error, {
            code: "WINDOWS_ISOLATION_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
      },
      readFile: async (absolutePath) => {
        const result = await this.executeOperation({
          type: "read",
          path: this.toWorkspacePath(absolutePath)
        });
        if (!result.ok) {
          throw new WindowsIsolationError(result.error, {
            code: "WINDOWS_ISOLATION_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
        return Buffer.from(result.base64 ?? "", "base64");
      },
      writeFile: async (absolutePath, content) => {
        const result = await this.executeOperation({
          type: "write",
          path: this.toWorkspacePath(absolutePath),
          content
        });
        if (!result.ok) {
          throw new WindowsIsolationError(result.error, {
            code: "WINDOWS_ISOLATION_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
      }
    };
  }

  private toWorkspacePath(absolutePath: string): string {
    const resolvedPath = path.resolve(absolutePath);
    const workspaceRoot = path.resolve(this.options.workspaceDir);
    const relative = path.relative(workspaceRoot, resolvedPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new WindowsIsolationError(`分離実行では workspace 外のパスは扱えません: ${resolvedPath}`, {
        code: "WINDOWS_ISOLATION_INVALID_PATH",
        stage: "setup"
      });
    }
    return resolvedPath;
  }

  private async executeOperation(operation: IsolationOperation): Promise<IsolationOperationResult> {
    this.ensureAvailable();

    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const runDir = path.join(WINDOWS_ISOLATION_BASE_DIR, runId);
    const operationPath = path.join(runDir, "operation.json");
    const runnerPath = path.join(runDir, "runner.ps1");
    const resultPath = path.join(runDir, "result.json");
    const scratchDir = path.join(runDir, "scratch");

    await fsp.mkdir(runDir, { recursive: true });
    await Promise.all([
      fsp.writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`, "utf8"),
      fsp.writeFile(runnerPath, ISOLATED_RUNNER_PS1, "utf8"),
      fsp.mkdir(scratchDir, { recursive: true })
    ]);

    this.options.logger.info("windows_isolation_run_start", {
      operation: operation.type,
      runDir
    });

    try {
      const commandResult = await runCommand("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        runnerPath,
        "-OperationPath",
        operationPath,
        "-ResultPath",
        resultPath,
        "-ScratchDir",
        scratchDir
      ], operation.type === "bash" ? operation.timeoutMs + 30_000 : DEFAULT_TIMEOUT_MS);

      if (!fs.existsSync(resultPath)) {
        return {
          ok: false,
          stage: "retrieve",
          error: commandResult.stderr.trim() || "分離実行結果を取得できませんでした。"
        };
      }

      const result = JSON.parse(await fsp.readFile(resultPath, "utf8")) as IsolationOperationResult;
      this.options.logger.info("windows_isolation_run_end", {
        operation: operation.type,
        ok: result.ok
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, stage: "execute", error: message };
    } finally {
      await cleanupRunDir(runDir);
    }
  }
}

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function runCommand(filePath: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(filePath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`分離実行がタイムアウトしました (${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8")
      });
    });
  });
}

function buildIsolatedEnvironment(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const preservedKeys = [
    "ComSpec",
    "PATHEXT",
    "PATH",
    "Path",
    "SystemDrive",
    "SystemRoot",
    "TEMP",
    "TMP",
    "WINDIR",
    "windir"
  ];
  const nextEnv: NodeJS.ProcessEnv = {};
  for (const key of preservedKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      nextEnv[key] = value;
    }
  }

  for (const blockedKey of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy"]) {
    nextEnv[blockedKey] = "";
  }

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") {
        nextEnv[key] = value;
      }
    }
  }

  return nextEnv;
}

async function cleanupRunDir(runDir: string): Promise<void> {
  try {
    await fsp.rm(runDir, { recursive: true, force: true });
  } catch {
    // cleanup is best-effort
  }
}

export function isWindowsIsolatedExecutionAvailable(): boolean {
  return process.platform === "win32";
}

export { WindowsIsolationError as WindowsSandboxError };
export { WindowsIsolatedExecutor as WindowsSandboxExecutor };
export const isWindowsSandboxAvailable = isWindowsIsolatedExecutionAvailable;

export async function enableWindowsSandboxFeature(): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error: "Windows Sandbox 依存の有効化フローは廃止されました。設定の『Windows 分離実行でツールを実行する』を利用してください。"
  };
}

const ISOLATED_RUNNER_PS1 = `
param(
  [Parameter(Mandatory = $true)][string]$OperationPath,
  [Parameter(Mandatory = $true)][string]$ResultPath,
  [Parameter(Mandatory = $true)][string]$ScratchDir
)

$ErrorActionPreference = "Stop"

function Write-Result {
  param([hashtable]$Payload)
  ($Payload | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $ResultPath -Encoding UTF8
}

try {
  $operation = Get-Content -LiteralPath $OperationPath -Raw | ConvertFrom-Json
  if (-not (Test-Path -LiteralPath $ScratchDir)) {
    New-Item -ItemType Directory -Path $ScratchDir -Force | Out-Null
  }

  [Environment]::SetEnvironmentVariable("HOME", $ScratchDir, "Process")
  [Environment]::SetEnvironmentVariable("USERPROFILE", $ScratchDir, "Process")
  [Environment]::SetEnvironmentVariable("TMP", $ScratchDir, "Process")
  [Environment]::SetEnvironmentVariable("TEMP", $ScratchDir, "Process")

  if ($operation.env) {
    $operation.env.PSObject.Properties | ForEach-Object {
      if ($_.Value -ne $null) {
        [Environment]::SetEnvironmentVariable([string]$_.Name, [string]$_.Value, "Process")
      }
    }
  }

  switch ($operation.type) {
    "bash" {
      if (-not (Test-Path -LiteralPath $operation.cwd)) {
        throw "cwd not found: $($operation.cwd)"
      }

      $stdoutPath = Join-Path $ScratchDir "stdout.txt"
      $stderrPath = Join-Path $ScratchDir "stderr.txt"
      if (Test-Path -LiteralPath $stdoutPath) { Remove-Item -LiteralPath $stdoutPath -Force }
      if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }

      if (Get-Command bash -ErrorAction SilentlyContinue) {
        $filePath = "bash"
        $args = @("-lc", [string]$operation.command)
      } else {
        $filePath = "powershell.exe"
        $args = @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", [string]$operation.command)
      }

      $proc = Start-Process -FilePath $filePath -ArgumentList $args -WorkingDirectory $operation.cwd -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
      $timeoutMs = if ($operation.timeoutMs) { [int]$operation.timeoutMs } else { 120000 }
      $waitSeconds = [Math]::Ceiling($timeoutMs / 1000.0)
      $finished = Wait-Process -Id $proc.Id -Timeout $waitSeconds -ErrorAction SilentlyContinue
      if (-not $finished) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        throw "command timed out"
      }

      $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
      $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
      Write-Result @{ ok = $true; exitCode = $proc.ExitCode; output = "$stdout$stderr" }
      exit 0
    }
    "write" {
      $target = [string]$operation.path
      $parent = Split-Path -LiteralPath $target -Parent
      if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
      }
      [System.IO.File]::WriteAllText($target, [string]$operation.content, [System.Text.Encoding]::UTF8)
      Write-Result @{ ok = $true }
      exit 0
    }
    "read" {
      $target = [string]$operation.path
      $bytes = [System.IO.File]::ReadAllBytes($target)
      Write-Result @{ ok = $true; base64 = [Convert]::ToBase64String($bytes) }
      exit 0
    }
    "access" {
      $target = [string]$operation.path
      if (-not (Test-Path -LiteralPath $target)) {
        throw "file not found: $target"
      }
      $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite)
      $stream.Close()
      Write-Result @{ ok = $true }
      exit 0
    }
    default {
      throw "unsupported operation: $($operation.type)"
    }
  }
} catch {
  Write-Result @{ ok = $false; stage = "execute"; error = $_.Exception.Message }
  exit 1
}
`;
