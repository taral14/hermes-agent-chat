#!/bin/sh
# Встановлює в Hermes плагін webchat, щоб Hermes міг сам писати в чат: результати задач за розкладом
# (доставка «Веб-чат») і send_message. Поруч із плагіном пише config.json з адресою й ключем цього чату,
# тож у ~/.hermes/.env нічого додавати не треба. Повторний запуск оновлює плагін.
#
# Налаштування з .env чату: HERMES_HOME, DATA_DIR, PORT, а якщо чат стоїть за роутером — ROUTER_URL і PUBLIC_HOST.
set -eu
DIR=$(cd "$(dirname "$0")/.." && pwd)
if [ -f "$DIR/.env" ]; then set -a; . "$DIR/.env"; set +a; fi

HERMES_HOME=${HERMES_HOME:-$HOME/.hermes}
case "$HERMES_HOME" in "~"*) HERMES_HOME="$HOME${HERMES_HOME#\~}";; esac
DATA_DIR=${DATA_DIR:-$DIR/data}
PORT=${PORT:-5190}
TOKEN_FILE="$DATA_DIR/.hermes-hook-token"

# За роутером чат прокидається від запиту на роутер із Host чату; інакше — напряму на порт чату.
if [ -n "${ROUTER_URL:-}" ]; then
  URL="${ROUTER_URL%/}/api/hooks/hermes"
  HOST_HEADER=${PUBLIC_HOST:-}
else
  URL="http://127.0.0.1:$PORT/api/hooks/hermes"
  HOST_HEADER=""
fi

[ -d "$HERMES_HOME" ] || { echo "Не знайдено Hermes у $HERMES_HOME. Встанови Hermes Agent або задай HERMES_HOME у .env."; exit 1; }
[ -f "$TOKEN_FILE" ] || { echo "Немає $TOKEN_FILE. Запусти чат хоча б раз (npm start): він створить ключ."; exit 1; }

DEST="$HERMES_HOME/plugins/webchat"
mkdir -p "$DEST"
cp "$DIR/hermes-plugin/webchat/plugin.yaml" "$DIR/hermes-plugin/webchat/__init__.py" "$DIR/hermes-plugin/webchat/adapter.py" "$DEST/"
URL="$URL" HOST_HEADER="$HOST_HEADER" TOKEN_FILE="$TOKEN_FILE" DEST="$DEST" node -e '
  const fs = require("fs")
  const cfg = { url: process.env.URL, host: process.env.HOST_HEADER, token_file: process.env.TOKEN_FILE, home: "schedule" }
  fs.writeFileSync(process.env.DEST + "/config.json", JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 })
'
echo "Плагін скопійовано в $DEST"
echo "  хук: $URL${HOST_HEADER:+ (Host: $HOST_HEADER)}"

HERMES_BIN=${HERMES_BIN:-$(command -v hermes || echo "$HOME/.local/bin/hermes")}
if [ -x "$HERMES_BIN" ]; then
  "$HERMES_BIN" plugins enable webchat
  echo "Готово. Щоб gateway підключив веб-чат, перезапусти його, коли Hermes нічого не робить:"
  echo "  $HERMES_BIN gateway restart"
  echo "Перевірка: $HERMES_BIN send -t webchat:Тест \"привіт\""
else
  echo "Не знайшов команду hermes. Увімкни плагін вручну: hermes plugins enable webchat, потім hermes gateway restart."
fi
