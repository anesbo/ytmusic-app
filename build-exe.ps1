# Builds LiquidYTM frontend + standalone Windows executable (dist-exe\LiquidYTM.exe)
param(
    [switch]$Release
)

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

Write-Host "Building frontend..." -ForegroundColor Cyan
npm run build

$profile = if ($Release) { "release" } else { "debug" }
Write-Host "Building standalone LiquidYTM ($profile + embedded frontend)..." -ForegroundColor Cyan

Push-Location "src-tauri"
try {
    if ($Release) {
        cargo build --release --features custom-protocol
    } else {
        cargo build --features custom-protocol
    }
} finally {
    Pop-Location
}

$outDir = Join-Path $env:CARGO_TARGET_DIR $profile
$exeSrc = Join-Path $outDir "liquid-ytm.exe"

if (Test-Path $exeSrc) {
    New-Item -ItemType Directory -Force -Path "dist-exe" | Out-Null
    Copy-Item $exeSrc "dist-exe\LiquidYTM.exe" -Force
    $wv2 = Get-ChildItem (Join-Path $outDir "build") -Recurse -Filter "WebView2Loader.dll" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "x64" } | Select-Object -First 1
    if ($wv2) {
        Copy-Item $wv2.FullName "dist-exe\WebView2Loader.dll" -Force
    } elseif (Test-Path (Join-Path $outDir "WebView2Loader.dll")) {
        Copy-Item (Join-Path $outDir "WebView2Loader.dll") "dist-exe\WebView2Loader.dll" -Force
    }
    Write-Host "Built standalone executable: dist-exe\LiquidYTM.exe" -ForegroundColor Green
} else {
    throw "Could not locate built liquid-ytm.exe in $outDir"
}
