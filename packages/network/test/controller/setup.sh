#!/usr/bin/env bash
# Prepares a freshly started test controller (`docker compose up -d` in this
# directory) so lifecycle tests can manage everything a real console allows:
#
#   1. complete first-run setup (admin account);
#   2. register a fake, offline UDM Pro as the site's gateway, so
#      gateway-managed networks can be created;
#   3. run the real zone-based firewall migration, which creates the built-in
#      zones (Internal, External, Gateway, Vpn, Hotspot, Dmz).
#
# Afterwards the Integration API is reachable like a console's:
#   base URL  http://localhost:18080/proxy/network/integration
#   API key   ${UNIFI_TEST_API_KEY:-alchemy-unifi-test-key}
set -euo pipefail
cd "$(dirname "$0")"

base="https://localhost:18443"
user="admin"
pass="Test-Passw0rd!"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT

echo "waiting for controller..."
for _ in $(seq 1 120); do
	if curl -sk "$base/status" | grep -q '"up":true'; then break; fi
	sleep 2
done

post() { curl -skf -b "$jar" -c "$jar" -H 'Content-Type: application/json' "$@" >/dev/null; }

echo "first-run setup"
post -X POST "$base/api/cmd/sitemgr" -d "{\"cmd\":\"add-default-admin\",\"name\":\"$user\",\"email\":\"$user@example.invalid\",\"x_password\":\"$pass\"}"
post -X POST "$base/api/cmd/system" -d '{"cmd":"set-installed"}'
post -X POST "$base/api/login" -d "{\"username\":\"$user\",\"password\":\"$pass\"}"

echo "registering fake gateway"
docker compose exec -T mongo mongosh -u root -p root --quiet --eval '
	const unifi = db.getSiblingDB("unifi");
	const site = unifi.site.findOne({ name: "default" });
	unifi.device.updateOne(
		{ mac: "02:00:00:00:00:02" },
		{ $setOnInsert: { mac: "02:00:00:00:00:02", type: "udm", model: "UDMPRO", adopted: true,
			site_id: site._id.toString(), name: "fake-gateway", version: "4.4.6", state: 1, ip: "192.168.1.1" } },
		{ upsert: true },
	);' >/dev/null

echo "migrating to zone-based firewall"
csrf="$(awk 'tolower($6) ~ /csrf/ { print $7 }' "$jar")"
post -X POST "$base/v2/api/site/default/firewall/migrate" -H "X-Csrf-Token: $csrf" -d '{}'

echo "ready: http://localhost:18080/proxy/network/integration"
