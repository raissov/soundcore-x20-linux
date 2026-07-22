#!/usr/bin/env bash
# Переключает режим шумоподавления soundcore Sport X20 (A3968) по кругу.
# Вешается на хоткей. Управление идёт по фирменному протоколу Soundcore
# через openscq30-cli (RFCOMM), а не через BlueZ.

set -uo pipefail

# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

CLI="${HP_OPENSCQ30_CLI:-${OPENSCQ30_CLI:-$HOME/.local/bin/openscq30-cli}}"
CLI="${CLI/#\~/$HOME}"

# Порядок перебора. Убрать "Normal", если нужен простой тумблер ANC <-> прозрачность.
MODES=("NoiseCanceling" "Transparency" "Normal")

# Человеческие названия и иконки (все проверены через Gtk.IconTheme.has_icon)
label_of() {
    case "$1" in
        NoiseCanceling) printf '%s' "Шумоподавление" ;;
        Transparency)   printf '%s' "Прозрачность" ;;
        Normal)         printf '%s' "Обычный режим" ;;
        *)              printf '%s' "$1" ;;
    esac
}

icon_of() {
    case "$1" in
        NoiseCanceling) printf '%s' "audio-volume-muted-symbolic" ;;
        Transparency)   printf '%s' "microphone-sensitivity-high-symbolic" ;;
        Normal)         printf '%s' "audio-headphones-symbolic" ;;
        *)              printf '%s' "audio-headphones-symbolic" ;;
    esac
}

fail() {
    notify-send -i "dialog-error-symbolic" -u normal "🎧 ANC" "$1"
    echo "$1" >&2
    exit 1
}

[[ -x "$CLI" ]] || fail "openscq30-cli не найден: $CLI"

# После set устройство отдаёт новое состояние только через ~2с (измерено).
# Поэтому при частых нажатиях крутим цикл от того, что сами поставили,
# а не от заведомо устаревшего ответа наушников.
STATE_FILE="${XDG_RUNTIME_DIR:-/tmp}/anc-toggle.state"
STALE_SEC=3

now=$(date +%s)

# Что говорят наушники
current=$("$CLI" device -a "$HEADSET_MAC" setting -g ambientSoundMode 2>/dev/null \
          | awk '/^ambientSoundMode/ {print $2}')
[[ -n "$current" ]] || fail "Наушники не отвечают — подключены ли они?"

# Если сами переключали только что — верим себе, а не кэшу устройства
if [[ -r "$STATE_FILE" ]]; then
    read -r last_mode last_ts < "$STATE_FILE" 2>/dev/null || true
    if [[ -n "${last_mode:-}" && -n "${last_ts:-}" ]] \
       && (( now - last_ts <= STALE_SEC )); then
        current="$last_mode"
    fi
fi

# Следующий по кругу
next="${MODES[0]}"
for i in "${!MODES[@]}"; do
    if [[ "${MODES[$i]}" == "$current" ]]; then
        next="${MODES[$(( (i + 1) % ${#MODES[@]} ))]}"
        break
    fi
done

# Проверяем КОД ВОЗВРАТА, а не вывод: "get после set" по документации CLI
# просто печатает обратно то, что мы задали, и ничего не подтверждает.
if ! "$CLI" device -a "$HEADSET_MAC" setting -s "ambientSoundMode=$next" >/dev/null 2>&1; then
    fail "Не удалось переключить в $(label_of "$next")"
fi
applied="$next"
printf '%s %s\n' "$next" "$now" > "$STATE_FILE"

# Для шумоподавления показываем ещё и силу — Weak/Moderate/Strong
extra=""
if [[ "$applied" == "NoiseCanceling" ]]; then
    strength=$("$CLI" device -a "$HEADSET_MAC" setting -g manualNoiseCanceling 2>/dev/null \
               | awk '/^manualNoiseCanceling/ {print $2}')
    case "$strength" in
        Weak)     extra=$'\n'"сила: слабое" ;;
        Moderate) extra=$'\n'"сила: среднее" ;;
        Strong)   extra=$'\n'"сила: сильное" ;;
    esac
fi

notify-send -i "$(icon_of "$applied")" -u low -t 1500 \
    "🎧 $(label_of "$applied")" \
    "soundcore Sport X20${extra}"

echo "$(date '+%H:%M:%S')  $current -> $applied"
