"""Переклад коротких текстів допоміжною моделлю Hermes (та сама, що пише назви сесій).

Запускається в середовищі Hermes (команду дає `hermes --print-runtime-command`), разовим процесом:
  stdin:  {"texts": ["...", ...], "lang": "Ukrainian"}
  stdout: {"translations": ["...", ...]}  або  {"error": "..."}
"""
import json
import re
import sys

from agent.auxiliary_client import call_llm

PROMPT = (
    "Translate every string of the JSON array the user sends into {lang}. Keep product and brand names, "
    "code, commands, file paths, URLs and Markdown formatting unchanged. Answer with a JSON array of the "
    "translated strings only, in the same order, with no comments. When a text addresses the reader, use the "
    "informal singular form (in Ukrainian: «ти», not «ви»)."
)


def main():
    req = json.load(sys.stdin)
    texts = [str(t) for t in req["texts"]]
    res = call_llm(
        task="translation",
        messages=[
            {"role": "system", "content": PROMPT.format(lang=req.get("lang") or "Ukrainian")},
            {"role": "user", "content": json.dumps(texts, ensure_ascii=False)},
        ],
        max_tokens=4000,
        timeout=90,
    )
    content = res.choices[0].message.content if hasattr(res, "choices") else str(res)
    # Деякі моделі загортають відповідь у ```json … ```.
    content = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", content or "")
    out = json.loads(content)
    if not isinstance(out, list) or len(out) != len(texts) or not all(isinstance(x, str) for x in out):
        raise ValueError("модель повернула не той формат")
    print(json.dumps({"translations": out}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # одна відповідь у stdout, хай що сталося
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"[:300]}, ensure_ascii=False))
