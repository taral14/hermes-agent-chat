"""Голос для чату: розпізнавання мови й озвучка засобами самого Hermes (налаштування stt і tts у config.yaml).

Довгоживучий процес у середовищі Hermes (команду дає `hermes --print-runtime-command`): модель локального
Whisper завантажується один раз і лишається в пам'яті між записами. Запити — рядки JSON на stdin:
  {"id": 1, "op": "stt", "path": "/…/voice.m4a"}         → {"id": 1, "text": "…"}
  {"id": 2, "op": "tts", "text": "…", "out": "/…/a.mp3"}  → {"id": 2, "files": ["/…/a.mp3"]}
Помилка — {"id": …, "error": "…"}. Процес завершується, коли закривається stdin.
"""
import json
import sys

# Підказка мови для локального Whisper: без неї він часто «перекладає» українську на англійську.
# Мова лишається автовизначеною, тож російська чи англійська розпізнаються як є.
STT_PROMPT = "Привіт. Це повідомлення українською."


def stt(path: str) -> str:
    from tools import transcription_tools as tt

    cfg = tt._load_stt_config()
    provider = tt._get_provider(cfg)
    if provider == "local":
        model = (cfg.get("local") or {}).get("model") or tt.DEFAULT_LOCAL_MODEL
        result = tt._transcribe_local(path, model, prompt=STT_PROMPT)
    else:
        result = tt.transcribe_audio(path, source="webchat")
    if not result.get("success"):
        raise RuntimeError(result.get("error") or "не вдалося розпізнати")
    return (result.get("transcript") or "").strip()


def tts(text: str, out: str) -> list:
    from tools.tts_tool import text_to_speech_tool

    result = json.loads(text_to_speech_tool(text, output_path=out))
    if not result.get("success"):
        raise RuntimeError(result.get("error") or "не вдалося озвучити")
    return result.get("file_paths") or [result["file_path"]]


def main():
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        rid = req.get("id")
        try:
            if req.get("op") == "stt":
                res = {"id": rid, "text": stt(req["path"])}
            elif req.get("op") == "tts":
                res = {"id": rid, "files": tts(req["text"], req["out"])}
            else:
                res = {"id": rid, "error": "невідома дія"}
        except Exception as exc:  # одна відповідь на запит, хай що сталося
            res = {"id": rid, "error": f"{type(exc).__name__}: {exc}"[:300]}
        sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
