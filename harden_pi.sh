#!/bin/bash
# ============================================================
# OctopCutes-Bot 香橙派部署點安全硬化腳本
# 冪等、可重跑、套用前自動備份。全程繁體中文。
# 執行方式：bash harden_pi.sh
# ============================================================
set -euo pipefail
LOG=/root/harden_pi.log

say() { echo "$1" | tee -a "$LOG"; }
say "=== 開始硬化 $(date '+%Y-%m-%d %H:%M:%S') ==="

# ---------- 1/5 SSH 強化 ----------
say "[1/5] SSH 強化"
SSHD=/etc/ssh/sshd_config
if [ ! -f "${SSHD}.bak" ]; then cp "$SSHD" "${SSHD}.bak"; say "  已備份 ${SSHD}.bak"; fi
apply_sshd() {
  local key="$1" val="$2"
  if grep -qE "^[#]*${key} " "$SSHD"; then
    sed -i "s/^[#]*${key} .*/${key} ${val}/" "$SSHD"
  else
    echo "${key} ${val}" >> "$SSHD"
  fi
  say "  ${key} ${val}"
}
apply_sshd PasswordAuthentication no
apply_sshd PermitRootLogin prohibit-password
apply_sshd MaxAuthTries 3
apply_sshd ClientAliveInterval 300
apply_sshd ClientAliveCountMax 2
sshd -t && systemctl reload ssh && say "  sshd 設定已驗證並重新載入"

# ---------- 2/5 防火牆 ufw ----------
say "[2/5] 防火牆 ufw"
if ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y ufw >> "$LOG" 2>&1 && say "  已安裝 ufw"
fi
# 先加 SSH 白名單再啟用（避免鎖死自己）
ufw allow from 192.168.0.0/24 to any port 22 proto tcp >/dev/null
CUR_IP=$(echo "${SSH_CLIENT:-}" | awk '{print $1}')
if [ -n "$CUR_IP" ]; then
  ufw allow from "$CUR_IP" to any port 22 proto tcp >/dev/null
  say "  允許 SSH 來源：$CUR_IP 與 192.168.0.0/24"
fi
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
say "  ufw 已啟用：預設拒絕流入，僅允許區域網路 SSH"

# ---------- 3/5 fail2ban ----------
say "[3/5] fail2ban 暴力破解防護"
if ! command -v fail2ban-server >/dev/null 2>&1; then
  apt-get install -y fail2ban >> "$LOG" 2>&1 && say "  已安裝 fail2ban"
fi
systemctl enable --now fail2ban >/dev/null 2>&1
systemctl is-active fail2ban >/dev/null && say "  fail2ban 運行中"

# ---------- 4/5 自動安全更新 ----------
say "[4/5] 自動安全更新"
if ! command -v unattended-upgrade >/dev/null 2>&1; then
  apt-get install -y unattended-upgrades >> "$LOG" 2>&1 && say "  已安裝 unattended-upgrades"
fi
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
say "  自動安全更新已啟用"

# ---------- 5/5 systemd 服務安全參數 ----------
say "[5/5] systemd 服務安全參數"
UNIT=/etc/systemd/system/octopus-bot.service
if [ ! -f "${UNIT}.bak" ]; then cp "$UNIT" "${UNIT}.bak"; say "  已備份 ${UNIT}.bak"; fi
cat > "$UNIT" <<'EOF'
[Unit]
Description=Octopus Discord Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/octopus-bot
ExecStart=/usr/local/bin/node bot.js
Restart=always
RestartSec=10
# ---- V0.2.9 安全參數（防提權/防資源耗盡/記憶體上限）----
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ReadWritePaths=/root/octopus-bot
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
MemoryHigh=200M
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl restart octopus-bot
sleep 8
if systemctl is-active octopus-bot >/dev/null; then
  say "  octopus-bot 安全參數套用後運行正常"
else
  say "  ❌ octopus-bot 啟動失敗，還原設定"
  cp "${UNIT}.bak" "$UNIT"
  systemctl daemon-reload
  systemctl restart octopus-bot
  exit 1
fi

say "=== 硬化完成 $(date '+%Y-%m-%d %H:%M:%S') ==="
