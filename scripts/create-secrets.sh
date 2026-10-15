#!/usr/bin/env bash
# Creates the secrets the cluster needs. Nothing here is stored in git.
set -euo pipefail

NS=identity
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace "$NS" pod-security.kubernetes.io/enforce=restricted --overwrite

if ! kubectl -n "$NS" get secret identity-db >/dev/null 2>&1; then
  kubectl -n "$NS" create secret generic identity-db --from-literal=password="$(openssl rand -hex 16)"
fi

if ! kubectl -n "$NS" get secret identity-tls >/dev/null 2>&1; then
  tmp=$(mktemp -d)
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -subj "/CN=identity.local" -addext "subjectAltName=DNS:identity.local" \
    -keyout "$tmp/tls.key" -out "$tmp/tls.crt" 2>/dev/null
  kubectl -n "$NS" create secret tls identity-tls --cert="$tmp/tls.crt" --key="$tmp/tls.key"
  rm -rf "$tmp"
fi

kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -
if ! kubectl -n monitoring get secret grafana-admin >/dev/null 2>&1; then
  kubectl -n monitoring create secret generic grafana-admin \
    --from-literal=admin-user=admin --from-literal=admin-password="$(openssl rand -hex 12)"
fi
