#!/usr/bin/env python3
"""
Индикатор наушников soundcore Sport X20 в верхней панели GNOME.

Показывает заряд рядом с часами и даёт быстро сменить режим шумоподавления.
Значок появляется только когда наушники подключены.

Нагрузка: опроса НЕТ вообще.
  * заряд           — по событиям UPower (PropertiesChanged);
  * подключение     — по событиям BlueZ;
  * режим ANC       — перечитывается при открытии меню (по RFCOMM события не идут).
"""

import os
import subprocess
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import AyatanaAppIndicator3 as AppIndicator  # noqa: E402
from gi.repository import Gio, GLib, Gtk  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hpcommon as hp  # noqa: E402

SETTINGS_APP = os.path.join(hp.HERE, "settings.py")

BLUEZ_PATH = hp.bluez_path()
UPOWER_PATH = hp.upower_path()

# Сигналы приходят пачками — склеиваем их, чтобы не дёргать наушники подряд
DEBOUNCE_MS = 400

MODES = [
    ("NoiseCanceling", "Шумоподавление"),
    ("Transparency", "Прозрачность"),
    ("Normal", "Обычный режим"),
]
STRENGTHS = [("Weak", "Слабое"), ("Moderate", "Среднее"), ("Strong", "Сильное")]

BATTERY_IDS = ["batteryLevelLeft", "batteryLevelRight", "caseBatteryLevel"]
MODE_IDS = ["ambientSoundMode", "manualNoiseCanceling"]


def to_percent(raw):
    if raw is None or raw == "":
        return None
    s = str(raw).strip()
    if "/" in s:
        a, _, b = s.partition("/")
        try:
            a, b = int(a), int(b)
        except ValueError:
            return None
        return round(a / b * 100) if b else None
    digits = "".join(ch for ch in s if ch.isdigit())
    return int(digits) if digits else None


class Indicator:
    def __init__(self):
        self.worker = hp.Worker()
        self.values = {}
        self.connected = False
        self.debounce = None
        self.suppress = False        # чтобы программная установка радио не слала команду

        self.ind = AppIndicator.Indicator.new(
            "hp-indicator", "audio-headphones-symbolic",
            AppIndicator.IndicatorCategory.HARDWARE)
        self.ind.set_status(AppIndicator.IndicatorStatus.PASSIVE)

        self.build_menu()
        self.ind.set_menu(self.menu)

        self.subscribe()
        self.refresh(full=True)

    # ---------- меню ----------

    def build_menu(self):
        self.menu = Gtk.Menu()

        self.item_batt = Gtk.MenuItem(label="Заряд: —")
        self.item_batt.set_sensitive(False)
        self.menu.append(self.item_batt)
        self.menu.append(Gtk.SeparatorMenuItem())

        self.mode_items = {}
        group = []
        for key, title in MODES:
            it = Gtk.RadioMenuItem(label=title)
            it.join_group(group[0] if group else None)
            group.append(it)
            it.connect("toggled", self.on_mode, key)
            self.mode_items[key] = it
            self.menu.append(it)

        self.menu.append(Gtk.SeparatorMenuItem())

        sub = Gtk.Menu()
        self.strength_items = {}
        sgroup = []
        for key, title in STRENGTHS:
            it = Gtk.RadioMenuItem(label=title)
            it.join_group(sgroup[0] if sgroup else None)
            sgroup.append(it)
            it.connect("toggled", self.on_strength, key)
            self.strength_items[key] = it
            sub.append(it)
        self.item_strength = Gtk.MenuItem(label="Сила шумоподавления")
        self.item_strength.set_submenu(sub)
        self.menu.append(self.item_strength)

        self.menu.append(Gtk.SeparatorMenuItem())

        it = Gtk.MenuItem(label="Настройки…")
        it.connect("activate", self.on_settings)
        self.menu.append(it)

        it = Gtk.MenuItem(label="Обновить")
        it.connect("activate", lambda *_: self.refresh(full=True))
        self.menu.append(it)

        it = Gtk.MenuItem(label="Выход")
        it.connect("activate", lambda *_: Gtk.main_quit())
        self.menu.append(it)

        self.menu.show_all()
        # Режим по RFCOMM событий не шлёт — перечитываем в момент открытия меню
        self.menu.connect("show", lambda *_: self.refresh(full=True))

    # ---------- события системы ----------

    def subscribe(self):
        try:
            bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
        except GLib.Error:
            return
        for path in (BLUEZ_PATH, UPOWER_PATH):
            bus.signal_subscribe(
                None, "org.freedesktop.DBus.Properties", "PropertiesChanged",
                path, None, Gio.DBusSignalFlags.NONE,
                lambda *a: self.on_signal(), None)

    def on_signal(self):
        if self.debounce is not None:
            GLib.source_remove(self.debounce)
        self.debounce = GLib.timeout_add(DEBOUNCE_MS, self._fire)

    def _fire(self):
        self.debounce = None
        self.refresh(full=True)
        return False

    # ---------- чтение состояния ----------

    def refresh(self, full=False):
        ids = BATTERY_IDS + MODE_IDS if full else BATTERY_IDS

        def job():
            if not hp.is_connected():
                return None
            return hp.get_values(ids)

        self.worker.submit(job, self.on_refreshed)

    def on_refreshed(self, res, err):
        if err or res is None:
            self.connected = False
            self.ind.set_status(AppIndicator.IndicatorStatus.PASSIVE)
            return False

        self.connected = True
        self.values.update(res)

        left = to_percent(self.values.get("batteryLevelLeft"))
        right = to_percent(self.values.get("batteryLevelRight"))
        case = to_percent(self.values.get("caseBatteryLevel"))

        known = [v for v in (left, right) if v is not None]
        worst = min(known) if known else None

        self.ind.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.ind.set_label("—" if worst is None else f"{worst}%", "100%")
        self.ind.set_icon_full(self.icon_for(worst), "Наушники")

        parts = [f"Л {left}%" if left is not None else "Л —",
                 f"П {right}%" if right is not None else "П —",
                 f"кейс {case}%" if case is not None else "кейс —"]
        self.item_batt.set_label("Заряд:  " + " · ".join(parts))

        self.sync_radio()
        return False

    @staticmethod
    def icon_for(pct):
        # Имена с -symbolic: в теме Yaru простых battery-full/good НЕТ
        if pct is None:
            return "audio-headphones-symbolic"
        if pct >= 80:
            return "battery-full-symbolic"
        if pct >= 50:
            return "battery-good-symbolic"
        if pct >= 20:
            return "battery-low-symbolic"
        return "battery-caution-symbolic"

    def sync_radio(self):
        """Ставит галочки, не вызывая отправку команды в наушники."""
        self.suppress = True
        try:
            mode = self.values.get("ambientSoundMode")
            if mode in self.mode_items:
                self.mode_items[mode].set_active(True)
            strength = self.values.get("manualNoiseCanceling")
            if strength in self.strength_items:
                self.strength_items[strength].set_active(True)
            self.item_strength.set_sensitive(mode == "NoiseCanceling")
        finally:
            self.suppress = False

    # ---------- действия ----------

    def apply(self, setting_id, value):
        def done(_res, err):
            if err:
                subprocess.Popen(
                    ["notify-send", "-i", "dialog-error-symbolic",
                     "🎧 Наушники", "Не удалось применить: " + err[:120]])
            # состояние отдаётся с задержкой ~2с — перечитываем с запасом
            GLib.timeout_add(2600, lambda: (self.refresh(full=True), False)[1])
            return False

        self.values[setting_id] = value       # оптимистично, чтобы галочка не прыгала
        self.worker.submit(lambda: hp.set_value(setting_id, value), done)

    def on_mode(self, item, key):
        if self.suppress or not item.get_active():
            return
        self.apply("ambientSoundMode", key)
        self.item_strength.set_sensitive(key == "NoiseCanceling")

    def on_strength(self, item, key):
        if self.suppress or not item.get_active():
            return
        self.apply("manualNoiseCanceling", key)

    def on_settings(self, *_):
        try:
            subprocess.Popen([sys.executable, SETTINGS_APP], start_new_session=True,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            pass


def main():
    Indicator()
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
