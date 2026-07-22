#!/usr/bin/env python3
"""
Всплывающий 3D-виджет наушников soundcore Sport X20.

Одноразовый: показался -> покрутился -> уехал -> вышел.
В простое процесса нет вообще, поэтому и GPU в покое не греется.

Событие подключения даёт headphone-notify.sh (DBus), а не этот скрипт —
логика определения коннекта и заряда там уже отлажена, дублировать её нельзя.

Клик по карточке открывает панель настроек (settings.py).
"""

import argparse
import json
import os
import subprocess
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")     # иначе gi подтянет Gdk 4.0 и подерётся с Gtk3
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hpcommon as hp  # noqa: E402

START_URI = hp.SCHEME + ":///index.html"
SETTINGS_APP = os.path.join(hp.HERE, "settings.py")

WIDTH, HEIGHT = 366, 156
MARGIN_X, MARGIN_Y = 18, 18

WANTED = [
    "batteryLevelLeft", "batteryLevelRight", "caseBatteryLevel",
    "ambientSoundMode", "manualNoiseCanceling",
]

STRENGTH_RU = {"Weak": "слабое", "Moderate": "среднее", "Strong": "сильное"}


def build_payload(demo=False):
    if demo:
        return {
            "name": "soundcore Sport X20",
            "left": "2/5", "right": "3/5", "case": "5/5",
            "anc": "NoiseCanceling", "strength": "сильное",
        }
    try:
        d = hp.get_values(WANTED)
    except Exception:                      # noqa: BLE001 — виджет не должен падать
        d = {}
    return {
        "name": "soundcore Sport X20",
        "left": d.get("batteryLevelLeft"),
        "right": d.get("batteryLevelRight"),
        "case": d.get("caseBatteryLevel"),
        "anc": d.get("ambientSoundMode"),
        "strength": STRENGTH_RU.get(d.get("manualNoiseCanceling") or "", ""),
    }


class Widget:
    def __init__(self, hold_ms, demo, click_test=False):
        self.hold_ms = hold_ms
        self.demo = demo
        self.click_test = click_test
        self.hide_source = None
        self.leaving = False

        self.win = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
        self.win.set_decorated(False)
        self.win.set_resizable(False)
        self.win.set_keep_above(True)
        self.win.set_skip_taskbar_hint(True)
        self.win.set_skip_pager_hint(True)
        # Клики мыши приходят и без фокуса; так виджет не перехватит
        # клавиатуру, если он всплыл посреди набора текста.
        self.win.set_accept_focus(False)
        self.win.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
        self.win.set_default_size(WIDTH, HEIGHT)
        self.win.set_app_paintable(True)

        screen = self.win.get_screen()
        visual = screen.get_rgba_visual()
        if visual is not None:
            self.win.set_visual(visual)      # без этого прозрачности не будет

        hp.install_scheme(WebKit2)

        ucm = WebKit2.UserContentManager()
        ucm.register_script_message_handler("hp")
        ucm.connect("script-message-received::hp", self.on_message)

        self.view = WebKit2.WebView(user_content_manager=ucm)
        self.view.set_background_color(Gdk.RGBA(0, 0, 0, 0))
        if os.environ.get("HP_WIDGET_DEBUG"):
            st = self.view.get_settings()
            st.set_enable_write_console_messages_to_stdout(True)
            st.set_enable_developer_extras(True)
            self.view.connect(
                "load-failed",
                lambda _v, _e, uri, err: print("LOAD FAILED", uri, err.message),
            )
        # При set_resizable(False) GTK берёт НАТУРАЛЬНЫЙ размер дочернего виджета,
        # а не set_default_size — без этого окно раздувалось до 366x200.
        self.view.set_size_request(WIDTH, HEIGHT)
        self.view.load_uri(START_URI)
        self.win.add(self.view)

        self.win.connect("destroy", lambda *_: Gtk.main_quit())
        self.place()

    def place(self):
        """Правый верхний угол рабочей области монитора с указателем."""
        display = Gdk.Display.get_default()
        monitor = None
        try:
            ptr = display.get_default_seat().get_pointer()
            _s, px, py = ptr.get_position()
            monitor = display.get_monitor_at_point(px, py)
        except Exception:
            pass
        if monitor is None:
            monitor = display.get_primary_monitor() or display.get_monitor(0)
        area = monitor.get_workarea()
        self.win.move(area.x + area.width - WIDTH - MARGIN_X, area.y + MARGIN_Y)

    # --- сообщения из страницы ---

    def on_message(self, _ucm, result):
        msg = self.extract(result)
        if msg == "ready":
            self.on_ready()
        elif msg == "hover":
            self.cancel_hide()
        elif msg == "unhover":
            self.schedule_hide()
        elif msg == "open-settings":
            self.open_settings()
        elif msg == "closed":
            Gtk.main_quit()

    @staticmethod
    def extract(result):
        for getter in ("get_js_value", "get_value"):
            if hasattr(result, getter):
                try:
                    return getattr(result, getter)().to_string()
                except Exception:
                    pass
        try:
            return result.to_string()
        except Exception:
            return ""

    # --- жизненный цикл ---

    def js(self, script):
        if hasattr(self.view, "evaluate_javascript"):
            self.view.evaluate_javascript(script, -1, None, None, None, None, None)
        else:
            self.view.run_javascript(script, None, None, None)

    def on_ready(self):
        payload = build_payload(self.demo)
        self.js("window.hpWidget.setData(%s); window.hpWidget.enter();"
                % json.dumps(payload, ensure_ascii=False))
        self.schedule_hide()
        if self.click_test:
            GLib.timeout_add(1500, lambda: (
                self.js("document.getElementById('card').click();"), False)[1])

    def open_settings(self):
        """Отпускаем панель в самостоятельную жизнь и убираем виджет."""
        try:
            subprocess.Popen(
                [sys.executable, SETTINGS_APP],
                start_new_session=True,          # переживёт выход виджета
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except OSError:
            pass
        self.cancel_hide()
        self.start_leave()

    def schedule_hide(self):
        self.cancel_hide()
        self.hide_source = GLib.timeout_add(self.hold_ms, self.start_leave)

    def cancel_hide(self):
        if self.hide_source is not None:
            GLib.source_remove(self.hide_source)
            self.hide_source = None

    def start_leave(self):
        self.hide_source = None
        if self.leaving:
            return False
        self.leaving = True
        self.js("window.hpWidget.leave();")
        # страховка: если страница не пришлёт 'closed', всё равно выходим
        GLib.timeout_add(1200, lambda: (Gtk.main_quit(), False)[1])
        return False

    def run(self):
        self.win.show_all()
        # жёсткий предохранитель от зависшего окна на экране
        GLib.timeout_add_seconds(60, lambda: (Gtk.main_quit(), False)[1])
        Gtk.main()


def main():
    ap = argparse.ArgumentParser(description="3D-виджет наушников")
    ap.add_argument("--hold", type=int, default=5000,
                    help="сколько миллисекунд держать на экране (по умолчанию 5000)")
    ap.add_argument("--demo", action="store_true",
                    help="показать с выдуманными данными, не опрашивая наушники")
    ap.add_argument("--click-test", action="store_true",
                    help="служебное: синтетический клик по карточке для проверки цепочки")
    args = ap.parse_args()

    Widget(args.hold, args.demo, args.click_test).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
