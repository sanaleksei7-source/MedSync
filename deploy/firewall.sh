#!/bin/sh
# Брандмауэр сервера MedSync (Ubuntu, ufw). Снаружи открыты только 80 и 443 (Caddy) и SSH с адреса администратора.
# Порт API 8787 и порт распознавания речи наружу НЕ открываются: API слушает 127.0.0.1, распознавание — внутреннюю сеть.
# Запуск: sudo ADMIN_IP=203.0.113.10 sh deploy/firewall.sh
set -eu
: "${ADMIN_IP:?Укажите ADMIN_IP — адрес, с которого администратор заходит по SSH}"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw limit from "$ADMIN_IP" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
