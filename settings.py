#!/usr/bin/env python3
"""
Панель настроек наушников soundcore Sport X20.

Интерфейс строится ПО СХЕМЕ, которую отдаёт само устройство
(openscq30-cli list-settings --json), поэтому показывает всё, что уши умеют,
и не разъедется, если прошивка добавит настройку.

Одно окно на систему: повторный запуск поднимает уже открытое.
"""

import json
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hpcommon as hp  # noqa: E402

APP_ID = "kz.raissov.HeadphoneSettings"
START_URI = hp.SCHEME + ":///settings.html"
WIDTH = int(os.environ.get("HP_SETTINGS_W", 760))
HEIGHT = int(os.environ.get("HP_SETTINGS_H", 640))

# После записи устройство отдаёт новое состояние не сразу (замерено ~2с),
# поэтому перечитываем с запасом, а не мгновенно.
REFRESH_AFTER_SET_MS = 2600


class SettingsWindow(Gtk.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="Наушники — настройки")
        self.set_default_size(WIDTH, HEIGHT)
        self.set_icon_name("audio-headphones")

        self.worker = hp.Worker()
        self.refresh_source = None
        self.schema = None

        hp.install_scheme(WebKit2)

        ucm = WebKit2.UserContentManager()
        ucm.register_script_message_handler("hp")
        ucm.connect("script-message-received::hp", self.on_message)

        self.view = WebKit2.WebView(user_content_manager=ucm)
        self.view.set_background_color(Gdk.RGBA(0.075, 0.075, 0.09, 1))
        if os.environ.get("HP_WIDGET_DEBUG"):
            st = self.view.get_settings()
            st.set_enable_write_console_messages_to_stdout(True)
            st.set_enable_developer_extras(True)
        self.view.load_uri(START_URI)
        self.add(self.view)
        self.show_all()

    # --- мост со страницей ---

    def js(self, script):
        if hasattr(self.view, "evaluate_javascript"):
            self.view.evaluate_javascript(script, -1, None, None, None, None, None)
        else:
            self.view.run_javascript(script, None, None, None)

    def to_page(self, obj):
        self.js("window.hpSettings.onMessage(%s);" % json.dumps(obj, ensure_ascii=False))

    def on_message(self, _ucm, result):
        raw = ""
        for getter in ("get_js_value", "get_value"):
            if hasattr(result, getter):
                try:
                    raw = getattr(result, getter)().to_string()
                    break
                except Exception:
                    pass
        try:
            msg = json.loads(raw)
        except (ValueError, TypeError):
            return

        op = msg.get("op")
        if op == "ready":
            self.load_all()
        elif op == "refresh":
            self.reload_values()
        elif op == "set":
            self.apply_setting(msg.get("id"), msg.get("value"))

    # --- операции ---

    def settings_ids(self):
        return [s["settingId"] for cat in self.schema for s in cat["settings"]]

    def load_all(self):
        def job():
            schema = hp.list_settings()
            ids = [s["settingId"] for cat in schema for s in cat["settings"]]
            return schema, hp.get_values(ids)

        def done(res, err):
            if err:
                self.to_page({"type": "error",
                              "error": "Наушники не отвечают. Подключены ли они?\n" + err})
                return False
            self.schema, values = res
            self.to_page({"type": "init", "schema": self.schema, "values": values})
            return False

        self.worker.submit(job, done)

    def reload_values(self):
        if not self.schema:
            return self.load_all()

        ids = self.settings_ids()

        def done(res, err):
            if err:
                self.to_page({"type": "setResult", "id": "", "ok": False, "error": err})
                return False
            self.to_page({"type": "values", "values": res})
            return False

        self.worker.submit(lambda: hp.get_values(ids), done)

    def apply_setting(self, setting_id, value):
        if not setting_id:
            return

        def done(_res, err):
            self.to_page({"type": "setResult", "id": setting_id,
                          "ok": err is None, "error": err or ""})
            self.schedule_refresh()
            return False

        self.worker.submit(lambda: hp.set_value(setting_id, value), done)

    def schedule_refresh(self):
        if self.refresh_source is not None:
            GLib.source_remove(self.refresh_source)
        self.refresh_source = GLib.timeout_add(REFRESH_AFTER_SET_MS, self._do_refresh)

    def _do_refresh(self):
        self.refresh_source = None
        self.reload_values()
        return False


class App(Gtk.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID)
        self.win = None

    def do_activate(self):
        if self.win is None:
            self.win = SettingsWindow(self)
        self.win.present()
        # Окно запускается не из клика по нему самому, поэтому mutter применяет
        # защиту от перехвата фокуса и НЕ поднимает его — панель оставалась за
        # другими окнами. Кратко поднимаем принудительно и сразу отпускаем,
        # чтобы окно не залипло поверх всех навсегда.
        self.win.set_keep_above(True)
        GLib.timeout_add(900, self._release_above)

    def _release_above(self):
        if self.win is not None:
            self.win.set_keep_above(False)
        return False


if __name__ == "__main__":
    sys.exit(App().run(sys.argv))
