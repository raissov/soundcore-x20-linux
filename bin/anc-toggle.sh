#!/usr/bin/env bash
# Переключает режим шумоподавления soundcore Sport X20 (A3968) по кругу.
# Вешается на хоткей. Управление идёт по фирменному протоколу Soundcore
# через openscq30-cli (RFCOMM), а не через BlueZ.

set -uo pipefail

# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

CLI="${HP_OPENSCQ30_CLI:-${OPENSCQ30_CLI:-$HOME/.local/bin/openscq30-cli}}"
CLI="${CLI/#\~/$HOME}"
DEVICE_NAME="soundcore Sport X20"

# Порядок перебора. Убрать "Normal", если нужен простой тумблер ANC <-> прозрачность.
MODES=("NoiseCanceling" "Transparency" "Normal")

# Человеческие названия и иконки (все проверены через Gtk.IconTheme.has_icon)
label_of() {
    local var="T_option_$1"
    printf '%s' "${!var:-$1}"
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
    notify-send -i "dialog-error-symbolic" -u normal "$T_notify_anc_title" "$1"
    echo "$1" >&2
    exit 1
}

[[ -x "$CLI" ]] || fail "$(fmt "$T_notify_cli_missing" path "$CLI")"

# После set устройство отдаёт новое состояние только через ~2с (измерено).
# Поэтому при частых нажатиях крутим цикл от того, что сами поставили,
# а не от заведомо устаревшего ответа наушников.
STATE_FILE="${XDG_RUNTIME_DIR:-/tmp}/anc-toggle.state"
STALE_SEC=3

now=$(date +%s)

# Что говорят наушники
current=$("$CLI" device -a "$HEADSET_MAC" setting -g ambientSoundMode 2>/dev/null \
          | awk '/^ambientSoundMode/ {print $2}')
[[ -n "$current" ]] || fail "$T_notify_not_responding"

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
    fail "$(fmt "$T_notify_switch_failed" mode "$(label_of "$next")")"
fi
applied="$next"
printf '%s %s\n' "$next" "$now" > "$STATE_FILE"

# Для шумоподавления показываем ещё и силу — Weak/Moderate/Strong
extra=""
if [[ "$applied" == "NoiseCanceling" ]]; then
    strength=$("$CLI" device -a "$HEADSET_MAC" setting -g manualNoiseCanceling 2>/dev/null \
               | awk '/^manualNoiseCanceling/ {print $2}')
    if [[ -n "$strength" ]]; then
        svar="T_option_$strength"
        extra=$'\n'"${T_notify_strength_prefix}$(printf '%s' "${!svar:-$strength}" | tr '[:upper:]' '[:lower:]')"
    fi
fi

notify-send -i "$(icon_of "$applied")" -u low -t 1500 \
    "🎧 $(label_of "$applied")" \
    "${DEVICE_NAME}${extra}"

echo "$(date '+%H:%M:%S')  $current -> $applied"
