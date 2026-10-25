#!/bin/sh
# linuxserver custom init: the UniFi OS authenticator only trusts requests that
# arrive on `unifi.local.http.port`, read from system.properties (not -D flags).
props=/config/data/system.properties
mkdir -p /config/data
touch "$props"
grep -q '^unifi.local.http.port=' "$props" || echo 'unifi.local.http.port=8080' >>"$props"
