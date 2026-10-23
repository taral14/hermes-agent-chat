#!/bin/sh
# Лише macOS. Встановлює launchd-агента, який дзеркалить Obsidian-сховище Hermes (iCloud Drive) у data/vault.
# Потрібен, бо процес чату, запущений як служба, macOS не пускає в iCloud Drive. Агент стартує через
# osascript, як gateway Hermes: так macOS пускає його туди.
# Сховище — VAULT_PATH з .env чату (DATA_DIR — куди класти копію). Повторний запуск оновлює агента.
# Видалити:
#   launchctl bootout gui/$(id -u)/com.hermes-chat.vault-mirror
#   rm ~/Library/LaunchAgents/com.hermes-chat.vault-mirror.plist
set -eu
DIR=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$DIR/.env" ]; then set -a; . "$DIR/.env"; set +a; fi
[ -n "${VAULT_PATH:-}" ] || { echo "Задай VAULT_PATH у .env чату: шлях до сховища Obsidian."; exit 1; }
LABEL=com.hermes-chat.vault-mirror
NODE=${NODE:-$(command -v node)}
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/chat-vault-mirror.log"
CMD="exec '$NODE' --env-file-if-exists='$DIR/.env' '$DIR/scripts/vault-mirror.mjs' >> '$LOG' 2>&1"
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
