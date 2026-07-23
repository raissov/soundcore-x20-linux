#!/usr/bin/env python3
"""
Локализация. Язык берётся из системной локали, с запасным вариантом — английским.

Порядок определения:
  1. переменная окружения HP_LANG
  2. LANGUAGE= в ~/.config/soundcore-x20/config
  3. системная локаль (LANGUAGE, LC_ALL, LC_MESSAGES, LANG)
  4. английский

Каталог нужного языка накладывается ПОВЕРХ английского, поэтому недостающий
перевод показывается по-английски, а не ключом вроде "ui.refresh".

Модуль намеренно не зависит ни от gi, ни от hpcommon: его дёргают
shell-скрипты (`python3 i18n.py --shell`), и тянуть туда GTK незачем.

Использование:
    from i18n import t
    t("ui.refresh")
    t("log.connected_battery", pct=40)

Из shell:
    eval "$(python3 i18n.py --shell)"     # даст T_ui_refresh='…' и т.д.
Из JS:
    python3 i18n.py --json                # каталог целиком
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
I18N_DIR = os.path.join(HERE, "i18n")
FALLBACK = "en"

CONFIG_FILE = os.path.join(
    os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"),
    "soundcore-x20", "config")


def _config_lang():
    """LANGUAGE= из конфига. Свой мини-парсер, чтобы не тянуть hpcommon (и gi)."""
    try:
        with open(CONFIG_FILE, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("LANGUAGE") and "=" in line:
                    return line.partition("=")[2].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def available():
    try:
        return sorted(f[:-5] for f in os.listdir(I18N_DIR) if f.endswith(".json"))
    except OSError:
        return [FALLBACK]


def detect_lang():
    candidates = [os.environ.get("HP_LANG", ""), _config_lang()]
    for var in ("LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"):
        candidates.append(os.environ.get(var, ""))

    known = available()
    for raw in candidates:
        if not raw:
            continue
        # LANGUAGE может быть списком через двоеточие: "ru_RU:ru:en"
        for part in raw.split(":"):
            code = part.split(".")[0].split("_")[0].strip().lower()
            if code and code in known:
                return code
    return FALLBACK


def _load_file(lang):
    try:
        with open(os.path.join(I18N_DIR, lang + ".json"), encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def load(lang=None):
    lang = lang or detect_lang()
    catalog = _load_file(FALLBACK)
    if lang != FALLBACK:
        catalog.update(_load_file(lang))     # перевод поверх английского
    return catalog


LANG = detect_lang()
CATALOG = load(LANG)


def t(key, **kwargs):
    text = CATALOG.get(key, key)
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, IndexError, ValueError):
            return text
    return text


def _shell_name(key):
    return "T_" + "".join(ch if ch.isalnum() else "_" for ch in key)


def main(argv):
    if "--json" in argv:
        print(json.dumps(CATALOG, ensure_ascii=False))
    elif "--shell" in argv:
        for key, value in CATALOG.items():
            safe = str(value).replace("'", "'\\''")
            print("%s='%s'" % (_shell_name(key), safe))
    elif "--lang" in argv:
        print(LANG)
    else:
        print("язык: %s, доступны: %s, строк: %d"
              % (LANG, ", ".join(available()), len(CATALOG)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
