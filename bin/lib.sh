#!/usr/bin/env bash
# Общая шапка для shell-скриптов: конфиг и производные пути DBus.
# Подключается через `source`, самостоятельно не запускается.

CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/soundcore-x20/config"
# shellcheck source=/dev/null
[[ -r "$CONFIG_FILE" ]] && . "$CONFIG_FILE"

# Приоритет: переменная окружения -> конфиг
HEADSET_MAC="${HP_HEADSET_MAC:-${HEADSET_MAC:-}}"

if [[ -z "$HEADSET_MAC" ]]; then
    echo "MAC наушников не задан. Запустите install.sh или впишите" >&2
    echo "HEADSET_MAC=XX:XX:XX:XX:XX:XX в $CONFIG_FILE" >&2
    exit 1
fi

BT_ADAPTER="${BT_ADAPTER:-hci0}"
MAC_UNDERSCORE="${HEADSET_MAC//:/_}"

UPOWER_PATH="/org/freedesktop/UPower/devices/headset_dev_${MAC_UNDERSCORE}"
BLUEZ_PATH="/org/bluez/${BT_ADAPTER}/dev_${MAC_UNDERSCORE}"

# Каталог проекта (на уровень выше bin/)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
