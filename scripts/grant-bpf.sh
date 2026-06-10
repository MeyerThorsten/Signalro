#!/bin/bash
# Grant your user read/write access to /dev/bpf* so PacketRush (tcpdump) can
# capture packets without sudo — the same approach Wireshark's ChmodBPF uses.
#
#   sudo scripts/grant-bpf.sh            # install
#   sudo scripts/grant-bpf.sh uninstall  # undo
#
# What it does:
#   1. creates an `access_bpf` group (if missing) and adds you to it
#   2. chgrp/chmods /dev/bpf* now
#   3. installs a LaunchDaemon that reapplies step 2 on every boot
#      (BPF device permissions reset on reboot)
set -euo pipefail

GROUP=access_bpf
PLIST=/Library/LaunchDaemons/dev.packetrush.chmodbpf.plist
LABEL=dev.packetrush.chmodbpf

[ "$(uname)" = "Darwin" ] || { echo "error: macOS only (on Linux use: sudo setcap cap_net_raw,cap_net_admin+eip \"\$(command -v tcpdump)\")" >&2; exit 1; }
[ "${EUID}" -eq 0 ] || { echo "error: must run as root: sudo scripts/grant-bpf.sh" >&2; exit 1; }

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout system "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $PLIST. The $GROUP group and membership were left in place;"
  echo "remove with: sudo dscl . -delete /Groups/$GROUP"
  exit 0
fi

TARGET_USER="${SUDO_USER:-$(stat -f%Su /dev/console)}"
[ "$TARGET_USER" != "root" ] || { echo "error: could not determine the non-root user to grant access to" >&2; exit 1; }

# 1. group + membership
if ! dscl . -read "/Groups/$GROUP" > /dev/null 2>&1; then
  max_gid=$(dscl . -list /Groups PrimaryGroupID | awk '{print $2}' | sort -n | tail -1)
  dscl . -create "/Groups/$GROUP" PrimaryGroupID "$((max_gid + 1))"
  echo "Created group $GROUP"
fi
dseditgroup -o edit -a "$TARGET_USER" -t user "$GROUP"
echo "Added $TARGET_USER to $GROUP"

# 2. apply now
chgrp "$GROUP" /dev/bpf*
chmod g+rw /dev/bpf*
echo "Granted $GROUP rw on /dev/bpf*"

# 3. persist across reboots
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>RunAtLoad</key><true/>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>chgrp $GROUP /dev/bpf* &amp;&amp; chmod g+rw /dev/bpf*</string>
  </array>
</dict>
</plist>
EOF
chmod 644 "$PLIST"
launchctl bootout system "$PLIST" 2>/dev/null || true
launchctl bootstrap system "$PLIST"
echo "Installed $PLIST (reapplies permissions on boot)"
echo
echo "Done. Open a NEW terminal (group membership is read at login) and run:"
echo "  npm start"
