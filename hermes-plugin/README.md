# Плагін Hermes «webchat»

Робить веб-чат адресою доставки Hermes, як Telegram. Лише надсилання: результати задач за розкладом
і інструмент `send_message` приходять у чат повідомленнями з пушем. Розмови йдуть окремо, рідним протоколом.

## Встановлення

З теки чату (чат має бути хоч раз запущений — він створює ключ хука):

```sh
npm run setup:hermes
hermes gateway restart      # щоб gateway підключив адаптер; без цього працює окремий відправник
hermes send -t webchat:Тест "привіт"
```

Скрипт `scripts/install-hermes-plugin.sh` копіює цю теку в `$HERMES_HOME/plugins/webchat`, пише поруч
`config.json` і вмикає плагін (`hermes plugins enable webchat`). Повторний запуск оновлює плагін.

## Як працює

- Hermes викликає адаптер (або `standalone_sender_fn`, коли задача виконується поза gateway).
- Адаптер шле `POST <url>` з ключем із `token_file`. За замовчуванням `url` — `http://127.0.0.1:<PORT>/api/hooks/hermes`;
  якщо чат стоїть за роутером (`ROUTER_URL` у `.env` чату), запит іде через роутер із заголовком `Host` чату.
- Канал: `webchat` — чат «Розклад», `webchat:<назва>` — чат із такою назвою (створюється сам),
  `webchat:<id чату>` — конкретна розмова (так прив'язуються задачі, створені з розмови).
- Заголовок задачі (`Cronjob Response: …`) чат перетворює на заголовок «Назва задачі ›».
- Файли (`MEDIA:` у тексті або окремими викликами) стають вкладеннями; великі не копіюються.

## Налаштування

`config.json` поруч з `adapter.py` (його пише скрипт встановлення):

```json
{ "url": "http://127.0.0.1:5190/api/hooks/hermes", "host": "", "token_file": "/шлях/до/чату/data/.hermes-hook-token", "home": "schedule" }
```

Змінні `WEBCHAT_URL`, `WEBCHAT_HOST`, `WEBCHAT_TOKEN_FILE`, `WEBCHAT_HOME_CHANNEL` у `~/.hermes/.env`,
якщо задані, мають перевагу над `config.json`.
