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

# SwiftUI's App lifecycle needs scene support in the generated plist.
# Fail here instead of producing an installable app with no visible window.
/usr/libexec/PlistBuddy -c "Print :UIApplicationSceneManifest:UISceneConfigurations" \
  "$script_dir/ZYRONApp/Info.plist" >/dev/null || {
  echo "Falta la configuración de escenas de SwiftUI. Actualice ios/project.yml."
  exit 1
}
xcodebuild -resolvePackageDependencies -project "$project_path" -scheme ZYRON

if [[ "${1:-}" == "--verify-launch" ]]; then
  # Choose an installed iOS simulator instead of assuming a particular model.
  simulator_id="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
available = [d for runtime, group in devices.items() if ".iOS-" in runtime for d in group if d.get("isAvailable", False)]
if not available:
    sys.exit("No hay simuladores iOS instalados. Instale uno en Xcode > Settings > Platforms.")
print(next((d["udid"] for d in available if d["state"] == "Booted"), available[0]["udid"]))
')"
  xcodebuild \
    -project "$project_path" \
    -scheme ZYRON \
    -destination "platform=iOS Simulator,id=$simulator_id" \
    -only-testing:ZYRONLaunchTests \
    CODE_SIGNING_ALLOWED=NO \
    test
elif [[ "${1:-}" == "--verify" ]]; then
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
