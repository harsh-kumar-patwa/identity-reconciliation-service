#!/usr/bin/env bash
# Builds the whole local environment: kind cluster, ingress, monitoring, Argo CD and the app.
set -euo pipefail
cd "$(dirname "$0")/.."

kind get clusters | grep -qx identity || kind create cluster --config deploy/kind/cluster.yaml

helm repo add traefik https://traefik.github.io/charts >/dev/null
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server >/dev/null
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
helm repo add grafana https://grafana.github.io/helm-charts >/dev/null
helm repo add argo https://argoproj.github.io/argo-helm >/dev/null
helm repo update >/dev/null

echo "Installing Traefik ingress controller"
helm upgrade --install traefik traefik/traefik -n traefik --create-namespace \
  -f deploy/traefik-values.yaml --wait

echo "Installing metrics-server (needed by the HPA)"
helm upgrade --install metrics-server metrics-server/metrics-server -n kube-system \
  --set 'args={--kubelet-insecure-tls}' --wait

./scripts/create-secrets.sh

echo "Installing monitoring"
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack -n monitoring \
  -f deploy/monitoring/kube-prometheus-values.yaml --wait --timeout 10m
helm upgrade --install loki grafana/loki -n monitoring -f deploy/monitoring/loki-values.yaml --wait
helm upgrade --install alloy grafana/alloy -n monitoring -f deploy/monitoring/alloy-values.yaml --wait
kubectl apply -f deploy/monitoring/jaeger.yaml
kubectl -n monitoring create configmap identity-dashboard \
  --from-file=deploy/monitoring/dashboards/identity.json --dry-run=client -o yaml \
  | kubectl label --local -f - grafana_dashboard=1 -o yaml | kubectl apply -f -

echo "Installing Argo CD"
helm upgrade --install argocd argo/argo-cd -n argocd --create-namespace \
  --set dex.enabled=false --set notifications.enabled=false --wait
kubectl apply -f deploy/argocd/identity-dev.yaml

echo "Done. Run scripts/smoke.sh to check the app."
