# Builds LiquidYTM frontend + standalone Windows executable (.exe)
$ErrorActionPreference = "Stop"

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

Write-Host "Building Rust + Tauri executable..." -ForegroundColor Cyan
cargo build --manifest-path "src-tauri/Cargo.toml" --release

$exeSrc = "C:\Users\anes\.cache\liquid-ytm-target\release\liquid-ytm.exe"
if (-not (Test-Path $exeSrc)) {
    $exeSrc = "src-tauri\target\release\liquid-ytm.exe"
}

if (Test-Path $exeSrc) {
    New-Item -ItemType Directory -Force -Path "dist-exe" | Out-Null
    Copy-Item $exeSrc "dist-exe\LiquidYTM.exe" -Force
    Write-Host "Built executable: dist-exe\LiquidYTM.exe" -ForegroundColor Green
} else {
    throw "Could not locate built liquid-ytm.exe"
}
