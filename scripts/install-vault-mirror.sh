#!/bin/sh
# Встановлює launchd-агента, який дзеркалить Obsidian-сховище Hermes (iCloud Drive) у chat/data/vault.
# Агент стартує через osascript, як gateway Hermes: так macOS пускає його в iCloud Drive.
# Повторний запуск оновлює агента. Видалити:
#   launchctl bootout gui/$(id -u)/com.com.hermes-chat.vault-mirror
#   rm ~/Library/LaunchAgents/com.com.hermes-chat.vault-mirror.plist
set -eu
LABEL=com.com.hermes-chat.vault-mirror
DIR=$(cd "$(dirname "$0")/.." && pwd)
NODE=${NODE:-$HOME/.hermes/node/bin/node}
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/chat-vault-mirror.log"
CMD="exec '$NODE' '$DIR/scripts/vault-mirror.mjs' >> '$LOG' 2>&1"
JS="ObjC.import(\"stdlib\"); const status=\$.system(\"$CMD\"); \$.exit(status === -1 ? 1 : (status >> 8) & 255);"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-l</string>
    <string>JavaScript</string>
    <string>-e</string>
    <string>$(printf '%s' "$JS" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Встановлено $LABEL. Журнал: $LOG"
