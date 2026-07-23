#!/usr/bin/env bash
# soundcore-x20-linux installer: config, systemd units, app entry, hotkeys.
# Touches nothing system-wide — only ~/.config and ~/.local (no sudo).

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/soundcore-x20"
CONFIG_FILE="$CONFIG_DIR/config"
UNIT_DIR="$HOME/.config/systemd/user"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }

# ---------------------------------------------------------------- зависимости

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || { warn "missing command: $1 ($2)"; return 1; }
}

say "Checking dependencies…"
missing=0
need_cmd bluetoothctl "bluez package" || missing=1
need_cmd notify-send  "libnotify-bin package" || missing=1
need_cmd python3      "python3" || missing=1
python3 -c 'import gi; gi.require_version("Gtk","3.0"); gi.require_version("WebKit2","4.1")' 2>/dev/null \
    || { warn "python3-gi with Gtk3/WebKit2 is missing (python3-gi, gir1.2-webkit2-4.1)"; missing=1; }
python3 -c 'import gi; gi.require_version("AyatanaAppIndicator3","0.1")' 2>/dev/null \
    || warn "gir1.2-ayatanaappindicator3-0.1 is missing — the panel indicator will not work"
(( missing )) && { warn "Install what is missing and run again."; exit 1; }

CLI_PATH="${OPENSCQ30_CLI:-$HOME/.local/bin/openscq30-cli}"
if [[ ! -x "$CLI_PATH" ]]; then
    warn "openscq30-cli not found at $CLI_PATH"
    warn "Download the binary from the OpenSCQ30 releases page and put it there:"
    warn "  https://github.com/Oppzippy/OpenSCQ30/releases"
    exit 1
fi

# ---------------------------------------------------------------- выбор устройства

pick_device() {
    local -a macs names
    while read -r _ mac name; do
        [[ "${name,,}" == *soundcore* ]] || continue
        macs+=("$mac"); names+=("$name")
    done < <(bluetoothctl devices 2>/dev/null)

    if (( ${#macs[@]} == 0 )); then
        warn "No paired Soundcore devices found."
        warn "Pair your headphones and run again, or set the MAC manually in $CONFIG_FILE"
        exit 1
    fi
    if (( ${#macs[@]} == 1 )); then
        printf '%s' "${macs[0]}"
        return
    fi
    # Несколько устройств Soundcore — нельзя брать первое попавшееся
    warn "Several Soundcore devices found:"
    local i
    for i in "${!macs[@]}"; do
        printf '  %d) %s  %s\n' "$((i+1))" "${macs[$i]}" "${names[$i]}" >&2
    done
    local choice
    read -rp "Number of the device to use: " choice >&2
    [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#macs[@]} )) \
        || { warn "Invalid choice"; exit 1; }
    printf '%s' "${macs[$((choice-1))]}"
}

mkdir -p "$CONFIG_DIR"
if [[ -r "$CONFIG_FILE" ]] && grep -q '^HEADSET_MAC=' "$CONFIG_FILE"; then
    say "Config already exists: $CONFIG_FILE (keeping it)"
else
    MAC="$(pick_device)"
    cat > "$CONFIG_FILE" <<EOF
# soundcore-x20-linux configuration
HEADSET_MAC=$MAC
OPENSCQ30_CLI=$CLI_PATH
# Interface language: en, ru. Leave empty to follow the system locale.
LANGUAGE=
EOF
    chmod 600 "$CONFIG_FILE"
    say "Wrote config: $CONFIG_FILE (MAC $MAC)"
fi

# shellcheck source=/dev/null
. "$CONFIG_FILE"

# ---------------------------------------------------------------- регистрация в openscq30

if ! "$CLI_PATH" paired-devices list 2>/dev/null | grep -q "$HEADSET_MAC"; then
    say "Registering the device with openscq30…"
    MODEL="$("$CLI_PATH" list-models 2>/dev/null | awk '/Sport X20/ {print $1; exit}')"
    MODEL="${MODEL:-SoundcoreA3968}"
    "$CLI_PATH" paired-devices add -a "$HEADSET_MAC" -m "$MODEL" \
        || warn "registration failed — do it manually: $CLI_PATH paired-devices add -a $HEADSET_MAC -m <model>"
fi

# ---------------------------------------------------------------- юниты и ярлык

say "Installing systemd units…"
mkdir -p "$UNIT_DIR"
for unit in headphone-notify hp-indicator; do
    sed "s|@PROJECT_DIR@|$PROJECT_DIR|g" "$PROJECT_DIR/systemd/$unit.service" \
        > "$UNIT_DIR/$unit.service"
done

say "Installing the application entry…"
mkdir -p "$APP_DIR"
sed "s|@PROJECT_DIR@|$PROJECT_DIR|g" \
    "$PROJECT_DIR/desktop/soundcore-x20-settings.desktop" \
    > "$APP_DIR/soundcore-x20-settings.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$APP_DIR" 2>/dev/null || true

chmod +x "$PROJECT_DIR"/bin/*.sh "$PROJECT_DIR"/*.py

systemctl --user daemon-reload
systemctl --user enable --now headphone-notify.service
systemctl --user enable --now hp-indicator.service

# ---------------------------------------------------------------- хоткеи GNOME

if command -v gsettings >/dev/null 2>&1; then
    say "Setting up GNOME hotkeys…"
    BASE=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings
    K0="$BASE/soundcore-anc/"
    K1="$BASE/soundcore-settings/"
    SCHEMA=org.gnome.settings-daemon.plugins.media-keys.custom-keybinding

    existing="$(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings)"
    for k in "$K0" "$K1"; do
        [[ "$existing" == *"$k"* ]] && continue
        if [[ "$existing" == "@as []" || "$existing" == "[]" ]]; then
            existing="['$k']"
        else
            existing="${existing%]}, '$k']"
        fi
    done
    gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "$existing"

    gsettings set "$SCHEMA:$K0" name 'Headphones — cycle sound mode'
    gsettings set "$SCHEMA:$K0" command "$PROJECT_DIR/bin/anc-toggle.sh"
    gsettings set "$SCHEMA:$K0" binding '<Super><Shift>n'

    gsettings set "$SCHEMA:$K1" name 'Headphones — settings'
    gsettings set "$SCHEMA:$K1" command "$PROJECT_DIR/settings.py"
    gsettings set "$SCHEMA:$K1" binding '<Super><Shift>h'
fi

say ""
say "Done."
echo "  Super+Shift+N — cycle the sound mode"
echo "  Super+Shift+H — settings panel"
echo "  the panel icon appears when the headphones are connected"
echo ""
echo "Logs:  journalctl --user -u headphone-notify -f"
