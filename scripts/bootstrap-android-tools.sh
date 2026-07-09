#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT_DIR/.tools/downloads" "$ROOT_DIR/.tools/jdk" "$ROOT_DIR/.tools/android-sdk/cmdline-tools"
JDK_URL='https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk'
CMD_URL='https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'

if [ ! -x "$ROOT_DIR/.tools/jdk/bin/java.exe" ]; then
  if [ ! -f "$ROOT_DIR/.tools/downloads/temurin17.zip" ]; then
    echo 'Downloading Temurin JDK 17...'
    curl -L --fail --retry 3 -o "$ROOT_DIR/.tools/downloads/temurin17.zip" "$JDK_URL"
  fi
  rm -rf "$ROOT_DIR/.tools/jdk-tmp" "$ROOT_DIR/.tools/jdk"
  mkdir -p "$ROOT_DIR/.tools/jdk-tmp"
  unzip -q "$ROOT_DIR/.tools/downloads/temurin17.zip" -d "$ROOT_DIR/.tools/jdk-tmp"
  JDK_DIR="$(find "$ROOT_DIR/.tools/jdk-tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  mv "$JDK_DIR" "$ROOT_DIR/.tools/jdk"
  rm -rf "$ROOT_DIR/.tools/jdk-tmp"
fi

if [ ! -x "$ROOT_DIR/.tools/android-sdk/cmdline-tools/latest/bin/sdkmanager.bat" ]; then
  if [ ! -f "$ROOT_DIR/.tools/downloads/android-cmdline-tools.zip" ]; then
    echo 'Downloading Android command-line tools...'
    curl -L --fail --retry 3 -o "$ROOT_DIR/.tools/downloads/android-cmdline-tools.zip" "$CMD_URL"
  fi
  rm -rf "$ROOT_DIR/.tools/android-sdk/cmdline-tools/latest" "$ROOT_DIR/.tools/android-sdk/cmdline-tools/cmdline-tools"
  unzip -q "$ROOT_DIR/.tools/downloads/android-cmdline-tools.zip" -d "$ROOT_DIR/.tools/android-sdk/cmdline-tools"
  mv "$ROOT_DIR/.tools/android-sdk/cmdline-tools/cmdline-tools" "$ROOT_DIR/.tools/android-sdk/cmdline-tools/latest"
fi

export JAVA_HOME="$ROOT_DIR/.tools/jdk"
export ANDROID_SDK_ROOT="$ROOT_DIR/.tools/android-sdk"
export ANDROID_HOME="$ANDROID_SDK_ROOT"
export PATH="$JAVA_HOME/bin:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$PATH"

yes | sdkmanager.bat --sdk_root="$ANDROID_SDK_ROOT" --licenses >/tmp/inkqueue-android-licenses.log
sdkmanager.bat --sdk_root="$ANDROID_SDK_ROOT" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
java -version
adb version
