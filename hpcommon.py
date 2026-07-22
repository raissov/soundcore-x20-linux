"""
Общее для виджета и панели настроек: константы, отдача веб-файлов
по своему URI-скоупу и разговор с наушниками через openscq30-cli.

Все вызовы CLI идут строго по очереди в одном рабочем потоке:
RFCOMM-канал один, параллельные процессы наступали бы друг другу на ноги.
GTK при этом не подвисает — результат возвращается через GLib.idle_add.
"""

import json
import mimetypes
import os
import queue
import subprocess
import threading

from gi.repository import Gio, GLib

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "web")

CONFIG_DIR = os.path.join(
    os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"),
    "soundcore-x20")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config")


def read_config():
    """Простой KEY=VALUE. Тот же файл читают и shell-скрипты."""
    cfg = {}
    try:
        with open(CONFIG_FILE, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                cfg[key.strip()] = val.strip().strip('"').strip("'")
    except OSError:
        pass
    return cfg


def detect_mac():
    """Ищет наушники среди сопряжённых. Подключённые в приоритете.

    Важно: у пользователя может быть сопряжено НЕСКОЛЬКО устройств Soundcore
    (например Sport X20 и Sport X10). Брать первое попавшееся нельзя —
    при неоднозначности возвращаем пусто, пусть выбирает install.sh.
    """
    try:
        out = subprocess.run(["bluetoothctl", "devices"], capture_output=True,
                             text=True, timeout=10).stdout
    except (subprocess.TimeoutExpired, OSError):
        return ""
    found = []
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0] == "Device" and "soundcore" in parts[2].lower():
            found.append(parts[1])
    if not found:
        return ""
    if len(found) == 1:
        return found[0]
    for mac in found:                       # несколько — берём подключённое
        if _connected(mac):
            return mac
    return ""


CONFIG = read_config()
HEADSET_MAC = (os.environ.get("HP_HEADSET_MAC")
               or CONFIG.get("HEADSET_MAC")
               or "")
CLI = os.path.expanduser(
    os.environ.get("HP_OPENSCQ30_CLI")
    or CONFIG.get("OPENSCQ30_CLI")
    or "~/.local/bin/openscq30-cli")

# Свой URI-скоуп вместо file://: у file:// origin = null, и ES-модуль
# не может импортировать соседний файл — WebKit рубит это по CORS.
SCHEME = "hpapp"


def serve_file(request):
    path = (request.get_path() or "/").lstrip("/") or "index.html"
    full = os.path.normpath(os.path.join(WEB_DIR, path))
    if not full.startswith(WEB_DIR + os.sep) or not os.path.isfile(full):
        request.finish_error(GLib.Error.new_literal(
            Gio.io_error_quark(), "not found: " + path, Gio.IOErrorEnum.NOT_FOUND))
        return
    if full.endswith(".js"):
        mime = "text/javascript"      # иначе модуль не выполнится
    elif full.endswith(".html"):
        mime = "text/html"
    else:
        mime = mimetypes.guess_type(full)[0] or "application/octet-stream"
    with open(full, "rb") as fh:
        data = fh.read()
    request.finish(Gio.MemoryInputStream.new_from_data(data), len(data), mime)


def install_scheme(webkit):
    ctx = webkit.WebContext.get_default()
    ctx.register_uri_scheme(SCHEME, lambda req, *_: serve_file(req))
    ctx.get_security_manager().register_uri_scheme_as_cors_enabled(SCHEME)
    return ctx


# --------------------------------------------------------------------------


def _run(args, timeout=20):
    try:
        p = subprocess.run([CLI] + args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except OSError as e:
        return 127, "", str(e)


def _connected(mac):
    try:
        p = subprocess.run(["bluetoothctl", "info", mac],
                           capture_output=True, text=True, timeout=10)
        return "Connected: yes" in p.stdout
    except (subprocess.TimeoutExpired, OSError):
        return False


def is_connected():
    """Подключены ли наушники. Источник истины тот же, что у демона."""
    return bool(HEADSET_MAC) and _connected(HEADSET_MAC)


def upower_path():
    return "/org/freedesktop/UPower/devices/headset_dev_" + HEADSET_MAC.replace(":", "_")


def bluez_path(adapter="hci0"):
    return "/org/bluez/%s/dev_%s" % (adapter, HEADSET_MAC.replace(":", "_"))


def list_settings():
    """Схема настроек устройства: [{categoryId, settings:[{settingId,type,setting}]}]"""
    rc, out, err = _run(["device", "-a", HEADSET_MAC, "list-settings", "--json"], 25)
    if rc != 0:
        raise RuntimeError(err.strip() or "не удалось прочитать список настроек")
    return json.loads(out)


def get_values(ids):
    """{settingId: значение} — значение уже развёрнуто из обёртки {type,value}"""
    if not ids:
        return {}
    args = ["device", "-a", HEADSET_MAC, "setting", "-j"]
    for i in ids:
        args += ["-g", i]
    rc, out, err = _run(args, 30)
    if rc != 0:
        raise RuntimeError(err.strip() or "не удалось прочитать значения")
    result = {}
    for item in json.loads(out):
        v = item.get("value")
        result[item["settingId"]] = v.get("value") if isinstance(v, dict) else v
    return result


def set_value(setting_id, value):
    """Пишет настройку. Успех определяется КОДОМ ВОЗВРАТА.

    Проверять по выводу нельзя: по документации CLI 'get после set печатает
    то значение, которое было установлено' — то есть подтверждает сам себя.
    """
    if value is None:
        value = ""
    elif isinstance(value, bool):
        value = "true" if value else "false"
    else:
        value = str(value)
    rc, out, err = _run(
        ["device", "-a", HEADSET_MAC, "setting", "-s", f"{setting_id}={value}"], 25)
    if rc != 0:
        raise RuntimeError(err.strip() or out.strip() or "устройство не приняло значение")
    return True


class Worker:
    """Очередь задач к наушникам в одном потоке."""

    def __init__(self):
        self.q = queue.Queue()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        while True:
            job = self.q.get()
            if job is None:
                return
            fn, on_done = job
            try:
                res, err = fn(), None
            except Exception as e:      # noqa: BLE001 — любую ошибку показываем в UI
                res, err = None, str(e)
            GLib.idle_add(on_done, res, err)

    def submit(self, fn, on_done):
        self.q.put((fn, on_done))
