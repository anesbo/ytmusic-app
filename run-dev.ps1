# Launches LiquidYTM in desktop dev mode with the 64-bit MinGW toolchain prioritized on PATH.
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

npm run tauri dev
