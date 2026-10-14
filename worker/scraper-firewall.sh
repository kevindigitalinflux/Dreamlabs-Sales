#!/bin/sh
# Egress firewall for the scraper's browser network (172.30.50.0/24, bridge br-scrape).
#
# Why: the scraper drives a real Chrome that follows redirects and loads page resources, so checking
# only the first URL cannot stop it reaching internal addresses. This blocks every NEW connection from
# the scraper's own subnet to private, link-local and loopback space, and to the VPS itself, so the
# scraper can only reach the public internet. It touches ONLY traffic from that one subnet; n8n,
# Traefik and the rest of the host are unaffected. Idempotent: safe to run repeatedly (a systemd unit
# re-applies it after Docker starts).
set -eu

SUBNET="172.30.50.0/24"
IFACE="br-scrape"
CHAIN="LOOKUP-SCRAPER"

# --- forwarded traffic (to anything beyond the host) ---
iptables -N "$CHAIN" 2>/dev/null || true
iptables -F "$CHAIN"
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for net in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 \
           192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -A "$CHAIN" -d "$net" -j DROP
done
iptables -A "$CHAIN" -j RETURN

# hook into DOCKER-USER once
iptables -C DOCKER-USER -s "$SUBNET" -j "$CHAIN" 2>/dev/null || iptables -I DOCKER-USER 1 -s "$SUBNET" -j "$CHAIN"

# --- traffic to the VPS itself (ssh, Traefik, anything listening on the host) ---
iptables -C INPUT -i "$IFACE" -m conntrack --ctstate NEW -j DROP 2>/dev/null \
  || iptables -I INPUT 1 -i "$IFACE" -m conntrack --ctstate NEW -j DROP

echo "scraper egress firewall applied"
