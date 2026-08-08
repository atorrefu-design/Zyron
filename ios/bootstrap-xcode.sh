#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_path="$script_dir/ZYRON.xcodeproj"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Este bootstrap debe ejecutarse en macOS con Xcode instalado."
  exit 1
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Instala Xcode y selecciónalo con xcode-select antes de continuar."
  exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install xcodegen
  else
    echo "Falta XcodeGen. Instala Homebrew o ejecuta: brew install xcodegen"
    exit 1
  fi
fi

cd "$script_dir"
xcodegen generate
xcodebuild -resolvePackageDependencies -project "$project_path" -scheme ZYRON

if [[ "${1:-}" == "--verify" ]]; then
  xcodebuild \
    -project "$project_path" \
    -scheme ZYRON \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination "generic/platform=iOS Simulator" \
    CODE_SIGNING_ALLOWED=NO \
    build
else
  open "$project_path"
fi
