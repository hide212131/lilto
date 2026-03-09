import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Logger } from "./logger";

const SANDBOX_EXE_PATH = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsSandbox.exe");
const SANDBOX_WORKSPACE_PATH = "C:\\lilto\\workspace";
const SANDBOX_CONTROL_PATH = "C:\\lilto\\control";
const DEFAULT_TIMEOUT_MS = 120_000;

type SandboxOperation =
  | { type: "bash"; command: string; cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
  | { type: "write"; path: string; content: string }
  | { type: "read"; path: string }
  | { type: "access"; path: string };

type SandboxOperationResult =
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

export class WindowsSandboxError extends Error {
  readonly code: string;
  readonly stage: string;

  constructor(message: string, options?: { code?: string; stage?: string }) {
    super(message);
    this.name = "WindowsSandboxError";
    this.code = options?.code ?? "WINDOWS_SANDBOX_EXECUTION_FAILED";
    this.stage = options?.stage ?? "execute";
  }
}

export class WindowsSandboxExecutor {
  constructor(
    private readonly options: {
      workspaceDir: string;
      logger: Logger;
    }
  ) {}

  ensureAvailable(): void {
    if (process.platform !== "win32") {
      throw new WindowsSandboxError("Windows Sandbox は Windows でのみ利用できます。", {
        code: "WINDOWS_SANDBOX_UNAVAILABLE",
        stage: "start"
      });
    }
    if (!fs.existsSync(SANDBOX_EXE_PATH)) {
      throw new WindowsSandboxError(
        "Windows Sandbox が見つかりません。Windows の機能で Windows Sandbox を有効化してください。",
        {
          code: "WINDOWS_SANDBOX_UNAVAILABLE",
          stage: "start"
        }
      );
    }
  }

  createBashOperations(): BashOperations {
    return {
      exec: async (command, cwd, options) => {
        const sandboxCwd = this.toSandboxPath(path.resolve(cwd));
        const result = await this.executeOperation({
          type: "bash",
          command,
          cwd: sandboxCwd,
          timeoutMs: options.timeout ?? DEFAULT_TIMEOUT_MS,
          env: options.env
        });
        if (!result.ok) {
          throw new WindowsSandboxError(result.error, {
            code: "WINDOWS_SANDBOX_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
        if (result.output && result.output.length > 0) {
          options.onData(Buffer.from(result.output, "utf8"));
        }
        return { exitCode: typeof result.exitCode === "number" ? result.exitCode : 1 };
      }
    };
  }

  createWriteOperations(): WriteOperations {
    return {
      mkdir: async () => {
        // write 側で親ディレクトリを作成するため no-op で十分
      },
      writeFile: async (absolutePath, content) => {
        const sandboxPath = this.toSandboxPath(path.resolve(absolutePath));
        const result = await this.executeOperation({ type: "write", path: sandboxPath, content });
        if (!result.ok) {
          throw new WindowsSandboxError(result.error, {
            code: "WINDOWS_SANDBOX_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
      }
    };
  }

  createEditOperations(): EditOperations {
    return {
      access: async (absolutePath) => {
        const sandboxPath = this.toSandboxPath(path.resolve(absolutePath));
        const result = await this.executeOperation({ type: "access", path: sandboxPath });
        if (!result.ok) {
          throw new WindowsSandboxError(result.error, {
            code: "WINDOWS_SANDBOX_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
      },
      readFile: async (absolutePath) => {
        const sandboxPath = this.toSandboxPath(path.resolve(absolutePath));
        const result = await this.executeOperation({ type: "read", path: sandboxPath });
        if (!result.ok) {
          throw new WindowsSandboxError(result.error, {
            code: "WINDOWS_SANDBOX_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
        return Buffer.from(result.base64 ?? "", "base64");
      },
      writeFile: async (absolutePath, content) => {
        const sandboxPath = this.toSandboxPath(path.resolve(absolutePath));
        const result = await this.executeOperation({ type: "write", path: sandboxPath, content });
        if (!result.ok) {
          throw new WindowsSandboxError(result.error, {
            code: "WINDOWS_SANDBOX_EXECUTION_FAILED",
            stage: result.stage ?? "execute"
          });
        }
      }
    };
  }

  private toSandboxPath(absolutePath: string): string {
    const workspaceRoot = path.resolve(this.options.workspaceDir);
    const relative = path.relative(workspaceRoot, absolutePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      if (absolutePath === workspaceRoot) {
        return SANDBOX_WORKSPACE_PATH;
      }
      throw new WindowsSandboxError(
        `Sandbox 実行では workspace 外のパスは扱えません: ${absolutePath}`,
        { code: "WINDOWS_SANDBOX_INVALID_PATH", stage: "setup" }
      );
    }
    return path.win32.join(SANDBOX_WORKSPACE_PATH, relative.replace(/\//g, "\\"));
  }

  private async executeOperation(operation: SandboxOperation): Promise<SandboxOperationResult> {
    this.ensureAvailable();
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const runDir = path.join(os.tmpdir(), "lilto-sandbox-runs", runId);
    const runnerPath = path.join(runDir, "runner.ps1");
    const opPath = path.join(runDir, "operation.json");
    const resultPath = path.join(runDir, "result.json");
    const configPath = path.join(runDir, "run.wsb");

    await fsp.mkdir(runDir, { recursive: true });
    await Promise.all([
      fsp.writeFile(runnerPath, SANDBOX_RUNNER_PS1, "utf8"),
      fsp.writeFile(opPath, `${JSON.stringify(operation, null, 2)}\n`, "utf8"),
      fsp.writeFile(configPath, this.buildWsb(runDir), "utf8")
    ]);

    this.options.logger.info("windows_sandbox_run_start", {
      operation: operation.type,
      runDir
    });

    const sandboxProcess = spawn(SANDBOX_EXE_PATH, [configPath], {
      windowsHide: true,
      stdio: "ignore",
      detached: false
    });

    const startError = await new Promise<Error | null>((resolve) => {
      const timer = setTimeout(() => {
        sandboxProcess.removeAllListeners("error");
        resolve(null);
      }, 1500);
      sandboxProcess.once("error", (error) => {
        clearTimeout(timer);
        resolve(error);
      });
    });

    if (startError) {
      await this.cleanupRunDir(runDir);
      throw new WindowsSandboxError(`Windows Sandbox 起動に失敗しました: ${startError.message}`, {
        code: "WINDOWS_SANDBOX_UNAVAILABLE",
        stage: "start"
      });
    }

    try {
      const timeoutMs = operation.type === "bash" ? operation.timeoutMs + 30_000 : DEFAULT_TIMEOUT_MS;
      const result = await this.waitForResult(resultPath, timeoutMs);
      this.options.logger.info("windows_sandbox_run_end", {
        operation: operation.type,
        ok: result.ok
      });
      return result;
    } finally {
      if (!sandboxProcess.killed) {
        sandboxProcess.kill();
      }
      await this.cleanupRunDir(runDir);
    }
  }

  private buildWsb(controlHostDir: string): string {
    const workspaceHostDir = path.resolve(this.options.workspaceDir);
    const escapedWorkspace = xmlEscape(workspaceHostDir);
    const escapedControl = xmlEscape(path.resolve(controlHostDir));
    return `<?xml version="1.0" encoding="utf-8"?>
<Configuration>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>${escapedWorkspace}</HostFolder>
      <SandboxFolder>${SANDBOX_WORKSPACE_PATH}</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
    <MappedFolder>
      <HostFolder>${escapedControl}</HostFolder>
      <SandboxFolder>${SANDBOX_CONTROL_PATH}</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;${SANDBOX_CONTROL_PATH}\\runner.ps1&quot;</Command>
  </LogonCommand>
</Configuration>
`;
  }

  private async waitForResult(resultPath: string, timeoutMs: number): Promise<SandboxOperationResult> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(resultPath)) {
        try {
          const raw = await fsp.readFile(resultPath, "utf8");
          return JSON.parse(raw) as SandboxOperationResult;
        } catch (error) {
          return {
            ok: false,
            stage: "retrieve",
            error: `Sandbox 実行結果の読み取りに失敗しました: ${String(error)}`
          };
        }
      }
      await sleep(500);
    }
    return {
      ok: false,
      stage: "retrieve",
      error: "Sandbox 実行のタイムアウト待機に失敗しました。"
    };
  }

  private async cleanupRunDir(runDir: string): Promise<void> {
    try {
      await fsp.rm(runDir, { recursive: true, force: true });
    } catch {
      // Cleanup failure is non-fatal.
    }
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SANDBOX_RUNNER_PS1 = `
$ErrorActionPreference = "Stop"
$controlPath = "C:\\lilto\\control"
$opPath = Join-Path $controlPath "operation.json"
$resultPath = Join-Path $controlPath "result.json"

function Write-Result {
  param([hashtable]$Payload)
  ($Payload | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $resultPath -Encoding UTF8
}

try {
  $operation = Get-Content -LiteralPath $opPath -Raw | ConvertFrom-Json

  if ($operation.env -and $operation.type -eq "bash") {
    $operation.env.PSObject.Properties | ForEach-Object {
      if ($_.Value -ne $null) {
        [Environment]::SetEnvironmentVariable([string]$_.Name, [string]$_.Value, "Process")
      }
    }
  }

  switch ($operation.type) {
    "bash" {
      if (-not (Test-Path -LiteralPath $operation.cwd)) {
        throw "bash 実行 cwd が存在しません: $($operation.cwd)"
      }
      $commandText = [string]$operation.command
      $stdoutPath = Join-Path $env:TEMP "lilto-sandbox-stdout.txt"
      $stderrPath = Join-Path $env:TEMP "lilto-sandbox-stderr.txt"
      if (Test-Path -LiteralPath $stdoutPath) { Remove-Item -LiteralPath $stdoutPath -Force }
      if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }

      if (Get-Command bash -ErrorAction SilentlyContinue) {
        $filePath = "bash"
        $args = @("-lc", $commandText)
      } else {
        $filePath = "powershell.exe"
        $args = @("-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", $commandText)
      }

      $proc = Start-Process -FilePath $filePath -ArgumentList $args -WorkingDirectory $operation.cwd -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
      $timeoutMs = if ($operation.timeoutMs) { [int]$operation.timeoutMs } else { 120000 }
      $waitSeconds = [Math]::Ceiling($timeoutMs / 1000.0)
      $finished = Wait-Process -Id $proc.Id -Timeout $waitSeconds -ErrorAction SilentlyContinue
      if (-not $finished) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        throw "bash 実行がタイムアウトしました。"
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
      $base64 = [Convert]::ToBase64String($bytes)
      Write-Result @{ ok = $true; base64 = $base64 }
      exit 0
    }
    "access" {
      $target = [string]$operation.path
      if (-not (Test-Path -LiteralPath $target)) {
        throw "対象ファイルが存在しません: $target"
      }
      $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite)
      $stream.Close()
      Write-Result @{ ok = $true }
      exit 0
    }
    default {
      throw "未対応の Sandbox operation: $($operation.type)"
    }
  }
} catch {
  Write-Result @{ ok = $false; stage = "execute"; error = $_.Exception.Message }
  exit 1
}
`;
