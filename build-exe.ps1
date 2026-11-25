# Builds LiquidYTM frontend + standalone self-contained Windows app (dist-exe\LiquidYTM.exe)
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
    New-Item -ItemType Directory -Force -Path "dist-exe\bin" | Out-Null
    Copy-Item $exeSrc "dist-exe\LiquidYTM.exe" -Force

    # Bundle WebView2Loader.dll next to the executable
    $wv2 = Get-ChildItem (Join-Path $outDir "build") -Recurse -Filter "WebView2Loader.dll" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "x64" } | Select-Object -First 1
    if ($wv2) {
        Copy-Item $wv2.FullName "dist-exe\WebView2Loader.dll" -Force
    } elseif (Test-Path (Join-Path $outDir "WebView2Loader.dll")) {
        Copy-Item (Join-Path $outDir "WebView2Loader.dll") "dist-exe\WebView2Loader.dll" -Force
    }

    # Bundle yt-dlp.exe & ffmpeg.exe so user NEVER has to download them!
    if (Test-Path "src-tauri\vendor-bin\yt-dlp.exe") {
        Copy-Item "src-tauri\vendor-bin\yt-dlp.exe" "dist-exe\bin\yt-dlp.exe" -Force
    }
    if (Test-Path "src-tauri\vendor-bin\ffmpeg.exe") {
        Copy-Item "src-tauri\vendor-bin\ffmpeg.exe" "dist-exe\bin\ffmpeg.exe" -Force
    }

    Write-Host "Built self-contained executable: dist-exe\LiquidYTM.exe (with bundled yt-dlp & ffmpeg!)" -ForegroundColor Green
} else {
    throw "Could not locate built liquid-ytm.exe in $outDir"
}
