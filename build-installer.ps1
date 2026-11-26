# Builds full Windows Release Installers (NSIS .exe + MSI) for LiquidYTM
$ErrorActionPreference = "Stop"
$env:CARGO_TARGET_DIR = "C:\Users\anes\.cache\liquid-ytm-target"

$mingw64Candidates = @(
    "C:\Users\anes\winlibs\mingw64\bin",
    "C:\msys64\mingw64\bin",
    "C:\msys64\ucrt64\bin"
)
foreach ($dir in $mingw64Candidates) {
    if (Test-Path (Join-Path $dir "dlltool.exe")) {
        $env:PATH = "$dir;$env:PATH"
        break
    }
}

Write-Host "Building production frontend & Windows Release Installer..." -ForegroundColor Cyan
npm run tauri build
Write-Host "Installers generated under $env:CARGO_TARGET_DIR\release\bundle\" -ForegroundColor Green
