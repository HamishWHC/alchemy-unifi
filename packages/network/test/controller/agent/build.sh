#!/bin/sh
# Compiles the agent into /agent-out (run in a JDK 25 container by compose.yaml).
set -eu
cd /agent-src
javac -d /tmp/classes ApiKeyAgent.java
jar --create --file /agent-out/api-key-agent.jar --manifest MANIFEST.MF -C /tmp/classes .
