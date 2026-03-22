param(
  [string]$InstallPath = "C:\BuildTools",
  [switch]$IncludeRecommended = $true,
  [switch]$IncludeArm64 = $true,
  [switch]$IncludeX64 = $true
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[install-vs-build-tools] $Message"
}

function Get-VsInstallerPath {
  $installerPath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\setup.exe"
  if (-not (Test-Path -LiteralPath $installerPath)) {
    throw "Visual Studio Installer was not found: $installerPath"
  }

  return $installerPath
}

function Get-VsWherePath {
  $vsWherePath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $vsWherePath)) {
    throw "vswhere.exe was not found: $vsWherePath"
  }

  return $vsWherePath
}

function Get-BuildToolsInstance {
  param(
    [string]$VsWherePath,
    [string]$ExpectedInstallPath
  )

  $json = & $VsWherePath -products Microsoft.VisualStudio.Product.BuildTools -format json
  if (-not $json) {
    return $null
  }

  $instances = $json | ConvertFrom-Json
  if ($instances -isnot [System.Array]) {
    $instances = @($instances)
  }

  $normalizedPath = [System.IO.Path]::GetFullPath($ExpectedInstallPath)
  return $instances | Where-Object {
    $_.installationPath -and ([System.IO.Path]::GetFullPath($_.installationPath) -eq $normalizedPath)
  } | Select-Object -First 1
}

function Test-LinkerPresent {
  param(
    [string]$BuildToolsPath,
    [string]$Arch = "arm64"
  )

  $candidate = Join-Path $BuildToolsPath "VC\Tools\MSVC"
  if (-not (Test-Path -LiteralPath $candidate)) {
    return $false
  }

  $linker = Get-ChildItem -Path (Join-Path $candidate "*\bin\Host*\$Arch") -Filter link.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -ne $linker
}

function Test-MsvcLibPresent {
  param(
    [string]$BuildToolsPath,
    [string]$Arch = "arm64"
  )

  $candidate = Join-Path $BuildToolsPath "VC\Tools\MSVC"
  if (-not (Test-Path -LiteralPath $candidate)) {
    return $false
  }

  $lib = Get-ChildItem -Path (Join-Path $candidate "*\lib\$Arch") -Filter vcruntime.lib -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -ne $lib
}

$vsWherePath = Get-VsWherePath
$installerPath = Get-VsInstallerPath
$instance = Get-BuildToolsInstance -VsWherePath $vsWherePath -ExpectedInstallPath $InstallPath

if (-not $instance) {
  throw "Visual Studio Build Tools was not found at $InstallPath. Install Build Tools first."
}

$hasArm64 = (Test-LinkerPresent -BuildToolsPath $InstallPath -Arch "arm64") -and (Test-MsvcLibPresent -BuildToolsPath $InstallPath -Arch "arm64")
$hasX64 = (Test-LinkerPresent -BuildToolsPath $InstallPath -Arch "x64") -and (Test-MsvcLibPresent -BuildToolsPath $InstallPath -Arch "x64")

if ((-not $IncludeArm64 -or $hasArm64) -and (-not $IncludeX64 -or $hasX64)) {
  Write-Step "Required MSVC toolchains are already present. Nothing to install."
  exit 0
}

$arguments = @(
  "modify",
  "--installPath", $InstallPath,
  "--add", "Microsoft.VisualStudio.Workload.VCTools",
  "--add", "Microsoft.VisualStudio.Component.Windows11SDK.22621",
  "--passive",
  "--norestart",
  "--wait"
)

if ($IncludeRecommended) {
  $arguments += "--includeRecommended"
}

if ($IncludeArm64) {
  $arguments += @("--add", "Microsoft.VisualStudio.Component.VC.Tools.ARM64")
}

if ($IncludeX64) {
  $arguments += @("--add", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64")
}

Write-Step "Adding Visual C++ Build Tools workload to $InstallPath"
& $installerPath @arguments

if ($LASTEXITCODE -ne 0) {
  throw "Visual Studio Installer failed. exit code=$LASTEXITCODE"
}

if ($IncludeArm64 -and (-not ((Test-LinkerPresent -BuildToolsPath $InstallPath -Arch "arm64") -and (Test-MsvcLibPresent -BuildToolsPath $InstallPath -Arch "arm64")))) {
  throw "ARM64 MSVC tools are still missing after install. Check the Visual Studio Installer logs."
}

if ($IncludeX64 -and (-not ((Test-LinkerPresent -BuildToolsPath $InstallPath -Arch "x64") -and (Test-MsvcLibPresent -BuildToolsPath $InstallPath -Arch "x64")))) {
  throw "x64 MSVC tools are still missing after install. Check the Visual Studio Installer logs."
}

Write-Step "Requested MSVC toolchains are available."
