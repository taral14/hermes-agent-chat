"""Веб-чат як адреса доставки Hermes: задачі за розкладом і send_message.

Лише надсилання. Hermes передає текст і файли, плагін шле їх POST-ом на хук чату. Розмови з чатом
ідуть окремо, через рідний протокол gateway. Канал (chat_id) — чат у веб-чаті: «schedule» стає
чатом «Розклад», будь-яка інша назва — чатом із такою назвою.

Налаштування (від сильнішого до слабшого): змінні WEBCHAT_* у ~/.hermes/.env → config.json поруч
із цим файлом (його пише scripts/install-hermes-plugin.sh чату) → значення за замовчуванням.
  url         адреса хука, за замовчуванням http://127.0.0.1:5190/api/hooks/hermes
  host        заголовок Host, якщо чат стоїть за роутером, що розрізняє сайти за Host
  token_file  файл із ключем хука (data/.hermes-hook-token у теці чату)
  home        канал за замовчуванням (schedule)
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:  # httpx — залежність самого Hermes, але перевіряємо чесно
    HTTPX_AVAILABLE = False
    httpx = None  # type: ignore[assignment]

from gateway.config import Platform, PlatformConfig
from gateway.platforms._shared import get_scoped_secret as _get_scoped_secret, send_error
from gateway.platforms.base import BasePlatformAdapter, SendResult

logger = logging.getLogger(__name__)

NAME = "webchat"
HOME = "schedule"
MAX_MESSAGE_LENGTH = 100_000  # чат рендерить Markdown і не має ліміту месенджерів


_CONFIG_FILE = Path(__file__).with_name("config.json")


def _file_config() -> dict:
    try:
        data = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _setting(env: str, key: str, default: str) -> str:
    return (_get_scoped_secret(env, "") or "").strip() or str(_file_config().get(key) or "").strip() or default


def _url() -> str:
    return _setting("WEBCHAT_URL", "url", "http://127.0.0.1:5190/api/hooks/hermes")


def _host() -> str:
    return _setting("WEBCHAT_HOST", "host", "")


def _home() -> str:
    return _setting("WEBCHAT_HOME_CHANNEL", "home", HOME)


def _token_file() -> Path:
    return Path(os.path.expanduser(_setting("WEBCHAT_TOKEN_FILE", "token_file", "")))


def _token() -> str:
    path = _token_file()
    if not str(path) or str(path) == ".":
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _paths(media_files: Any) -> list[str]:
    """``media_files`` приходить і як список шляхів, і як список (шлях, is_voice)."""
    out: list[str] = []
    for item in media_files or []:
        path = item[0] if isinstance(item, (list, tuple)) and item else item
        if path:
            out.append(str(path))
    return out


async def _post(channel: str, text: str, media: Optional[list[str]] = None) -> dict:
    """Надіслати в чат. Роутер піднімає заснулий чат за кілька секунд, тому таймаут щедрий і є повтор."""
    if not HTTPX_AVAILABLE:
        return send_error("webchat: httpx не встановлено")
    token = _token()
    if not token:
        return send_error("webchat: немає ключа хука — запусти scripts/install-hermes-plugin.sh у теці чату")
    payload = {"channel": channel or _home(), "text": text or "", "media": media or []}
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if _host():
        headers["Host"] = _host()
    last = ""
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(_url(), json=payload, headers=headers)
            if resp.status_code < 300:
                data = resp.json()
                return {"success": True, "platform": NAME, "chat_id": payload["channel"], "message_id": data.get("message_id")}
            last = f"HTTP {resp.status_code}: {resp.text[:200]}"
            if resp.status_code not in (502, 503, 504):
                break
        except Exception as e:  # роутер ще будить чат
            last = str(e) or type(e).__name__
        await asyncio.sleep(2 * (attempt + 1))
    return send_error(f"webchat: {last}")


def _result(r: dict) -> SendResult:
    if r.get("success"):
        return SendResult(success=True, message_id=str(r.get("message_id") or ""))
    return SendResult(success=False, error=str(r.get("error") or "невідома помилка"))


class WebchatAdapter(BasePlatformAdapter):
    """Адаптер лише на вихід: вхідних повідомлень немає, розмови йдуть через рідний протокол."""

    MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH

    def __init__(self, config: PlatformConfig):
        super().__init__(config=config, platform=Platform(NAME))

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not HTTPX_AVAILABLE:
            logger.warning("[%s] httpx не встановлено", self.name)
            return False
        if not _token():
            logger.warning("[%s] немає ключа хука — запусти scripts/install-hermes-plugin.sh у теці чату", self.name)
            return False
        self._mark_connected()
        logger.info("[%s] Готовий надсилати в %s", self.name, _url())
        return True

    async def disconnect(self) -> None:
        self._mark_disconnected()

    async def send(self, chat_id: str, content: str, reply_to: Optional[str] = None,
                   metadata: Optional[dict[str, Any]] = None) -> SendResult:
        return _result(await _post(chat_id, content))

    async def _send_file(self, chat_id: str, path: str, caption: Optional[str]) -> SendResult:
        return _result(await _post(chat_id, caption or "", [path]))

    async def send_document(self, chat_id: str, file_path: str, caption: Optional[str] = None,
                            file_name: Optional[str] = None, reply_to: Optional[str] = None,
                            metadata: Optional[dict[str, Any]] = None, **kwargs) -> SendResult:
        return await self._send_file(chat_id, file_path, caption)

    async def send_voice(self, chat_id: str, audio_path: str, caption: Optional[str] = None,
                         reply_to: Optional[str] = None, metadata: Optional[dict[str, Any]] = None,
                         **kwargs) -> SendResult:
        return await self._send_file(chat_id, audio_path, caption)

    async def send_video(self, chat_id: str, video_path: str, caption: Optional[str] = None,
                         reply_to: Optional[str] = None, metadata: Optional[dict[str, Any]] = None,
                         **kwargs) -> SendResult:
        return await self._send_file(chat_id, video_path, caption)

    async def send_image_file(self, chat_id: str, image_path: str, caption: Optional[str] = None,
                              reply_to: Optional[str] = None, metadata: Optional[dict[str, Any]] = None,
                              **kwargs) -> SendResult:
        return await self._send_file(chat_id, image_path, caption)

    async def send_image(self, chat_id: str, image_url: str, caption: Optional[str] = None,
                         reply_to: Optional[str] = None, metadata: Optional[dict[str, Any]] = None,
                         **kwargs) -> SendResult:
        text = f"{caption}\n\n{image_url}" if caption else image_url
        return _result(await _post(chat_id, text))

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        name = "Розклад" if (chat_id or _home()) == HOME else chat_id
        return {"name": name, "type": "dm", "chat_id": chat_id}


async def _standalone_send(pconfig, chat_id: str, message: str, *, thread_id: Optional[str] = None,
                           media_files: Optional[list] = None, force_document: bool = False,
                           caption: Optional[str] = None, **kwargs) -> dict:
    """Надсилання поза процесом gateway: задачі за розкладом, CLI."""
    text = message or caption or ""
    return await _post(chat_id, text, _paths(media_files))


def _target_ref(ref: str):
    """``webchat:<канал>``: будь-яка непорожня назва — це канал (чат) у веб-чаті."""
    name = (ref or "").strip()
    return (name, None) if name else None


def _env_enablement() -> dict:
    """Плагін увімкнений без жодних змінних: канал за замовчуванням — «Розклад»."""
    return {"home_channel": {"chat_id": _home(), "name": "Розклад"}}


def _check() -> bool:
    return HTTPX_AVAILABLE


def _is_connected(config) -> bool:
    return bool(_token())


# Чат показує питання інструмента clarify карткою з варіантами-кнопками й полем для своєї відповіді.
# Без підказки модель зазвичай перелічує варіанти текстом, і на них не натиснеш.
CHOICES_HINT = (
    "Offering choices: when you need the user to pick between a few concrete options before you continue "
    "(\"A or B?\", \"which one?\", numbered alternatives), call the clarify tool with them as choices instead of "
    "listing them in prose. The user's chat shows each choice as a tappable button and always lets them type "
    "their own answer, so keep labels short (details go in the question), up to 4, recommended first. "
    "Don't ask about things you can reasonably decide yourself."
)


def _choices_section(info) -> str:
    """Лише сесії, де є картка: чат створює їх як «cli» (так само й класичний термінал Hermes, у нього своя панель)."""
    return CHOICES_HINT if info.get("platform") == "cli" else ""


def register(ctx) -> None:
    """Точка входу плагіна."""
    if hasattr(ctx, "register_system_prompt_section"):
        ctx.register_system_prompt_section("webchat-choices", _choices_section)
    ctx.register_platform(
        name=NAME,
        label="Веб-чат",
        adapter_factory=lambda cfg: WebchatAdapter(cfg),
        check_fn=_check,
        is_connected=_is_connected,
        target_ref_syntax_fn=_target_ref,
        dashboard_description="Власний веб-чат для Hermes: доставка результатів задач і send_message.",
        env_enablement_fn=_env_enablement,
        cron_deliver_env_var="WEBCHAT_HOME_CHANNEL",
        standalone_sender_fn=_standalone_send,
        max_message_length=MAX_MESSAGE_LENGTH,
        emoji="💬",
        pii_safe=True,
        allow_update_command=False,
        platform_hint=(
            "The webchat platform is the user's private web chat. It renders Markdown, "
            "tables and code, and shows audio, video, images and files from MEDIA: lines as players and cards. "
            "Use target 'webchat' for the default 'Розклад' chat, or 'webchat:<name>' for a chat with that name."
        ),
    )
