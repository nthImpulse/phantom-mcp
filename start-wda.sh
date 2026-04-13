#!/bin/bash
# start-wda.sh — Lance WebDriverAgent sur le simulateur actif

WDA_PATH="$HOME/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent"

# Trouver le nom du simulateur booted
BOOTED_DEVICE=$(xcrun simctl list devices booted | grep -oE '^\s+[^(]+' | head -1 | xargs)

if [ -z "$BOOTED_DEVICE" ]; then
  echo "Aucun simulateur actif. Lance-en un d'abord."
  exit 1
fi

echo "Lancement de WDA sur : $BOOTED_DEVICE"

cd "$WDA_PATH"
xcodebuild -project WebDriverAgent.xcodeproj \
  -scheme WebDriverAgentRunner \
  -destination "platform=iOS Simulator,name=$BOOTED_DEVICE" \
  test 2>&1 | grep -E "(ServerURL|Build Succeeded|Test Suite|error:)"
