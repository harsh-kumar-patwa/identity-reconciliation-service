# Identity reconciliation service

A web service that links customer contacts across purchases using email and phone number. It is the Bitespeed backend task, extended into a system that runs on Kubernetes with CI/CD, GitOps delivery and monitoring.

The starting point is commit `48eb0b6` and the git tag `baseline`. Everything after it is the DevOps work. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the parts fit together and [docs/DECISIONS.md](docs/DECISIONS.md) for why each choice was made.

## API

`POST /identify` takes an email, a phone number or both, and returns the linked contact group.

```json
{ "email": "john@example.com", "phoneNumber": "9876543210" }
```

```json
{
  "contact": {
    "primaryContactId": 1,
    "emails": ["john@example.com", "john.doe@example.com"],
    "phoneNumbers": ["9876543210"],
    "secondaryContactIds": [2]
  }
}
```

If nothing matches, the service creates a new primary contact. If the request adds a new email or phone to a known group, it creates a secondary contact. If the request connects two groups, the older primary stays primary and the newer one becomes its secondary.

Operational endpoints:

| Path | Purpose | Reachable from outside |
|---|---|---|
| `/livez` | The process is up. Used by the liveness probe. | No |
| `/readyz` | The app can reach Postgres. Used by the readiness probe. | No |
| `/metrics` | Prometheus metrics | No |
| `/version` | Image tag and git commit of the running build | Yes |
| `/health` | Kept from the original version | Yes |

## What changed from the baseline

The baseline had the API, a `/health` route, Prisma migrations and an `.env.example`. It had no tests, container, CI, Kubernetes setup or monitoring.

This branch adds:

- Health, readiness and version endpoints, graceful shutdown on SIGTERM, Prometheus metrics, JSON logs and OpenTelemetry tracing.
- A fix for a race in `/identify`. Twenty parallel requests for one new email used to create 6 primary contacts. The flow now runs in one transaction behind a Postgres advisory lock.
- Unit and integration tests run against a real Postgres.
- A Dockerfile that runs as a non-root user, and a compose file for local runs.
- A Helm chart with a dev and a prod values file.
- A GitHub Actions pipeline that tests, scans and builds the image, then waits for approval before releasing.
- Argo CD, which deploys from git.
- Prometheus, Grafana, Loki and Jaeger, plus an SLO with burn-rate alerts and a runbook.

## Prerequisites

- Docker Desktop with at least 8 GB of memory
- kind 0.33+, kubectl, helm 4+
- k6, only for the load test
- Node 22, only to run tests outside Docker

## Run with Docker Compose

```bash
docker compose up --build
curl -X POST localhost:3000/identify -H 'content-type: application/json' -d '{"email":"a@b.com"}'
```

## Run on a local Kubernetes cluster

```bash
./scripts/bootstrap.sh
```

The script creates a three-node kind cluster, installs Traefik, metrics-server, the monitoring stack and Argo CD, creates the secrets, and registers the Argo CD application. Argo CD then deploys the chart from the `devops/production-ready` branch. A full run takes about 10 minutes on a laptop.

Check the app:

```bash
./scripts/smoke.sh
```

The script calls `https://identity.local` through the ingress. It uses `curl --resolve`, so there is no need to edit `/etc/hosts`. To use a browser, add `127.0.0.1 identity.local` to `/etc/hosts`. The certificate is self-signed.

## Access

| Tool | Command | Address |
|---|---|---|
| Grafana | `kubectl -n monitoring port-forward svc/monitoring-grafana 3001:80` | http://localhost:3001 |
| Prometheus | `kubectl -n monitoring port-forward svc/monitoring-kube-prometheus-prometheus 9090` | http://localhost:9090 |
| Jaeger | `kubectl -n monitoring port-forward svc/jaeger-query 16686` | http://localhost:16686 |
| Argo CD | `kubectl -n argocd port-forward svc/argocd-server 8080:443` | https://localhost:8080 |

Grafana user is `admin`. Get the password with:

```bash
kubectl -n monitoring get secret grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d
```

Argo CD user is `admin`. Get the password with:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
```

## Release flow

1. A push to `devops/production-ready` or `main` starts the `ci` workflow.
2. The `test`, `security` and `chart` jobs run in parallel. The `image` job builds the image, scans it with Trivy and pushes it to GHCR as `sha-<commit>`.
3. The `release` job waits for a reviewer to approve the `dev` environment in GitHub. After approval it writes the new tag into `deploy/helm/identity-service/values-dev.yaml` and commits it.
4. Argo CD sees the commit and rolls out the new image.
5. `/version` and the `app.kubernetes.io/version` pod label show the running tag.

To roll back, revert the release commit and push. Argo CD deploys the previous tag.

## Tests

```bash
docker compose up -d db
export DATABASE_URL=postgresql://app:localdev@localhost:5432/identity
npx prisma migrate deploy
npm test
```

Integration tests skip themselves when `DATABASE_URL` is not set.

## Known limitations

- Postgres runs as a single replica. It is a single point of failure and has no backups beyond its volume.
- The TLS certificate is self-signed.
- Everything runs on one laptop cluster. Dev is the only live environment. `values-prod.yaml` shows how prod would differ.
- Secrets are created by `scripts/create-secrets.sh` and are not managed by a tool such as Sealed Secrets.
- Jaeger keeps traces in memory, so a restart loses them.
- The advisory lock serialises all writes to `/identify`. That is fine at this scale and would limit throughput at a much higher request rate.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Decisions and trade-offs](docs/DECISIONS.md)
- [Runbook](docs/RUNBOOK.md)
- [Evidence](docs/EVIDENCE.md)
