#!/usr/bin/env bash
# Runs the user journey through the ingress and prints the running version.
# --resolve points identity.local at the kind port mapping, so /etc/hosts does not need editing.
set -euo pipefail

c() { curl -sk --resolve identity.local:443:127.0.0.1 "$@"; }

echo "Version:"
c https://identity.local/version; echo

email="smoke-$(date +%s)@example.com"
echo "Identify $email:"
resp=$(c -X POST https://identity.local/identify -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"phoneNumber\":\"5550001\"}")
echo "$resp"
echo "$resp" | grep -q primaryContactId && echo "OK" || { echo "FAILED"; exit 1; }
