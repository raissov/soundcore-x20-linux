#!/usr/bin/env bash
# Демон на событиях DBus: показывает попап когда наушники подключаются.
# Прошлая версия (опрос раз в 2с) лежит рядом: headphone-notify.sh.poll.bak

# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

ICON="audio-headphones"
DEVICE_NAME="soundcore Sport X20"

# Страховка: если сигнал с шины почему-то потерялся, всё равно сверимся раз в N секунд
RESYNC_SEC=60
# Пауза перед перезапуском монитора, если тот умер
RETRY_SEC=5

# Ноль в любом написании: 0, 00, 0.0 — считаем "ещё не отрапортовано"
is_zero() {
    [[ "$1" =~ ^0+([.,]0+)?$ ]]
}

get_battery() {
    for _ in {1..12}; do
        local p
        p=$(upower -i "$UPOWER_PATH" 2>/dev/null | awk '/percentage/ {gsub(/%/,"",$2); print $2}')
        # Сразу после коннекта upower отдаёт устройство с зарядом 0 —
        # наушники ещё не успели отрапортовать. Ноль тоже ждём, не только пустоту.
        if [[ -n "$p" ]] && ! is_zero "$p"; then
            echo "$p"
            return
        fi
        sleep 1
    done
    # Так и не дождались осмысленного значения — лучше "неизвестно",
    # чем ложный critical-алерт про 0%
    echo "?"
}

is_connected() {
    bluetoothctl info "$HEADSET_MAC" 2>/dev/null | grep -q "Connected: yes"
}

# --- Помощники для уведомления -------------------------------------------

# Целое ли число (защита от "?" и от "60.000")
is_num() {
    [[ "$1" =~ ^[0-9]+$ ]]
}

# Иконка по уровню заряда.
# Имена с суффиксом -symbolic: в теме Yaru простых battery-full/battery-good НЕТ
# (проверено через Gtk.IconTheme.has_icon), иконка молча не отрисовалась бы.
battery_icon() {
    local p="$1"
    is_num "$p" || { printf '%s' "$ICON"; return; }
    if   (( p >= 80 )); then printf '%s' "battery-full-symbolic"
    elif (( p >= 50 )); then printf '%s' "battery-good-symbolic"
    elif (( p >= 20 )); then printf '%s' "battery-low-symbolic"
    else                     printf '%s' "battery-caution-symbolic"
    fi
}

# Полоска из 10 сегментов: ██████░░░░
battery_bar() {
    local p="$1" filled empty out="" i
    filled=$(( p / 10 ))
    (( filled > 10 )) && filled=10
    (( filled < 0 ))  && filled=0
    empty=$(( 10 - filled ))
    for ((i = 0; i < filled; i++)); do out+="█"; done
    for ((i = 0; i < empty;  i++)); do out+="░"; done
    printf '%s' "$out"
}

WIDGET="$PROJECT_DIR/widget.py"

# Запускает 3D-виджет. Возвращает 0, если он поднялся и держится на экране.
# Ждём 2с: этого хватает, чтобы поймать падение на старте (импорт, DISPLAY,
# отсутствие файлов), но не настолько долго, чтобы демон затупил.
show_widget() {
    [[ -f "$WIDGET" ]] || return 1
    setsid python3 "$WIDGET" >/dev/null 2>&1 &
    local pid=$!
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    wait "$pid" 2>/dev/null
    return 1
}

notify_connected() {
    local PERCENT CUR_ICON TITLE URGENCY BODY
    PERCENT=$(get_battery)

    CUR_ICON=$(battery_icon "$PERCENT")
    TITLE="$T_notify_connected_title"
    URGENCY="normal"

    if is_num "$PERCENT"; then
        BODY="$DEVICE_NAME"$'\n'"$(battery_bar "$PERCENT") ${PERCENT}%"
        if (( PERCENT < 20 )); then
            TITLE="$T_notify_connected_low_title"
            URGENCY="critical"
        fi
    else
        BODY="$DEVICE_NAME"$'\n'"$T_widget_battery_unknown"
    fi

    # Основной показ — 3D-виджет. Если он почему-то не поднялся,
    # откатываемся на обычный попап, чтобы уведомление не пропало совсем.
    if ! show_widget; then
        notify-send -i "$CUR_ICON" -u "$URGENCY" "$TITLE" "$BODY"
    fi

    if is_num "$PERCENT"; then
        echo "$(date '+%H:%M:%S')  $(fmt "$T_log_connected_battery" pct "$PERCENT")"
    else
        echo "$(date '+%H:%M:%S')  $T_log_connected_unknown"
    fi
}

# Сверяет реальное состояние и показывает попап только на переходе no -> yes.
# Истину о коннекте по-прежнему говорит is_connected, а не текст сигнала DBus.
check_state() {
    local CUR
    if is_connected; then CUR="yes"; else CUR="no"; fi
    [[ "$CUR" == "yes" && "$PREV" == "no" ]] && notify_connected
    PREV="$CUR"
}

echo "$T_log_listening"

cleanup() {
    [[ -n "${MON_PID:-}" ]] && kill "$MON_PID" 2>/dev/null
    exit 0
}
trap cleanup EXIT INT TERM

PREV="no"
while true; do
    # Сверяемся при старте и после каждого перезапуска монитора:
    # если наушники уже подключены — попап покажется сразу, как в старой версии.
    check_state

    coproc MON { gdbus monitor --system --dest org.bluez --object-path "$BLUEZ_PATH" 2>/dev/null; }

    while true; do
        rc=0
        IFS= read -r -t "$RESYNC_SEC" -u "${MON[0]}" line || rc=$?
        if   (( rc == 0 )); then
            # gdbus сказал "на объекте что-то поменялось"; что именно — не парсим,
            # истину о коннекте спрашиваем у is_connected внутри check_state
            case "$line" in
                *PropertiesChanged*) check_state ;;
            esac
        elif (( rc > 128 )); then
            check_state          # таймаут чтения — страховочная сверка
        else
            break                # EOF: монитор умер, идём его перезапускать
        fi
    done

    kill "$MON_PID" 2>/dev/null
    wait "$MON_PID" 2>/dev/null
    echo "$(date '+%H:%M:%S')  $(fmt "$T_log_monitor_restart" sec "$RETRY_SEC")"
    sleep "$RETRY_SEC"
done
