# Плагін Hermes «webchat»

Робить веб-чат адресою доставки Hermes, як Telegram. Лише надсилання: результати задач за розкладом
і інструмент `send_message` приходять у чат повідомленнями з пушем. Розмови йдуть окремо, рідним протоколом.

## Як працює

- Hermes викликає адаптер (або `standalone_sender_fn`, коли задача виконується поза gateway).
- Адаптер шле `POST http://127.0.0.1:8000/api/hooks/hermes` з `Host: chat.example.com` через роутер, тож
  заснулий чат прокидається сам. Ключ — `chat/data/.hermes-hook-token` (чат створює його при старті).
- Канал: `webchat` — чат «Розклад», `webchat:<назва>` — чат з такою назвою (створюється сам).
- Заголовок задачі (`Cronjob Response: …`) чат перетворює на плашку з переходом до задачі.
- Файли (`MEDIA:` у тексті або окремими викликами) стають вкладеннями; великі не копіюються.
- Коли ти відповідаєш у такому чаті, чат додає до запиту те, що Hermes сам туди надіслав,
  бо в сесії Hermes цього немає.

## Встановлення

```sh
cp -R hermes-plugin/webchat ~/.hermes/plugins/
hermes plugins validate ~/.hermes/plugins/webchat
hermes plugins enable webchat
hermes gateway restart   # щоб gateway підключив адаптер; без цього працює окремий відправник
```

Перевірка: `hermes send -t webchat:Тест "привіт"`.

Необов'язкові змінні в `~/.hermes/.env`: `WEBCHAT_URL`, `WEBCHAT_HOST`, `WEBCHAT_TOKEN_FILE`, `WEBCHAT_HOME_CHANNEL`.

Копія в `~/.hermes/plugins/webchat` — робоча; ця папка — її версія в git. Після змін скопіюй назад.
