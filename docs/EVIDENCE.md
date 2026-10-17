# Evidence

All evidence comes from this repository, its GitHub Actions runs and a local kind cluster on 17 October 2026. Files under [evidence/](evidence/) hold raw command output.

## Tested version

| Item | Value |
|---|---|
| Baseline | `48eb0b6`, tag `baseline` |
| Application commit tested | `07c752363c9777a5f7877ece5c8f6daac5a33029` |
| Image | `ghcr.io/harsh-kumar-patwa/identity-reconciliation-service:sha-07c7523` |
| Release commit | `93f6b10 Deploy sha-07c7523 to dev`, written by the pipeline after approval |
| Cluster | kind 0.33, Kubernetes 1.37, 1 control-plane and 2 workers |

Commits after `93f6b10` change docs, evidence and the game day config only. The application code and image did not change.

## Source to running pod

[evidence/release-trace.txt](evidence/release-trace.txt) follows one release through every step.

1. Commit `07c7523`.
2. CI run [39055385226](https://github.com/harsh-kumar-patwa/identity-reconciliation-service/actions/runs/39055385226) on that commit. `test`, `security`, `chart`, `image` and `release` all succeeded.
3. The `dev` environment approved by `harsh-kumar-patwa`.
4. `93f6b10` changed `image.tag` from `sha-8024d42` to `sha-07c7523`.
5. Argo CD `Synced` and `Healthy` at `93f6b10`.
6. All api pods carry the label `app.kubernetes.io/version=sha-07c7523`.
7. `/version` returns `sha-07c7523` with the full git SHA, and `/identify` returns a linked contact.

The rollout replaced 4 pods one at a time with `maxUnavailable: 0`.

## Pipeline gates that caught real problems

| Run | What failed | Fix |
|---|---|---|
| [39053033110](https://github.com/harsh-kumar-patwa/identity-reconciliation-service/actions/runs/39053033110) | `npm audit` found a critical `proxy-addr` advisory and a high `path-to-regexp` advisory | `npm audit fix`, commit `3d58f88` |
| [39053465452](https://github.com/harsh-kumar-patwa/identity-reconciliation-service/actions/runs/39053465452) | Trivy config scan, KSV-0014: Postgres root filesystem was writable | Read-only root with two `emptyDir` mounts, commit `8024d42` |
| [39053769661](https://github.com/harsh-kumar-patwa/identity-reconciliation-service/actions/runs/39053769661) | Nothing. First fully green run, released `sha-8024d42` | |

## User journey

From [evidence/release-trace.txt](evidence/release-trace.txt):

```
$ ./scripts/smoke.sh
Version:
{"version":"sha-07c7523","gitSha":"07c752363c9777a5f7877ece5c8f6daac5a33029","buildTime":"2026-10-17T23:17:59+05:30"}
Identify smoke-1792260050@example.com:
{"contact":{"primaryContactId":23,"emails":[...],"phoneNumbers":["5550001"],"secondaryContactIds":[24,25,5006]}}
OK
```

Checks run during setup:

- `http://identity.local/version` returns 301 to `https://`.
- `https://identity.local/metrics` and `/readyz` return 404 through the ingress.
- A pod in the `default` namespace cannot open a connection to `postgres.identity:5432` or to the api Service. An api pod can reach Postgres.
- Writing to `/` inside `postgres-0` fails with `Read-only file system`.

## Observability

- Prometheus scrapes both api pods through the ServiceMonitor, and all 10 rules in `identity-slo` load.
- Every log line in Loki carries a `trace_id`, and that id opens the matching trace in Jaeger. The game day write-up uses this path.
- Grafana loads the "Identity service" dashboard from `deploy/monitoring/dashboards/identity.json`.
- During the bad release, `IdentifyErrorBudgetFastBurn` fired 2 minutes 41 seconds after the rollout and resolved after the revert.

## Reliability tests

| Test | Result | Raw output |
|---|---|---|
| Bad release and rollback | Alert in 2m41s, errors at 0 about 1 minute after the revert push | [gameday-bad-release.txt](evidence/gameday-bad-release.txt) |
| Delete `postgres-0` | 2 failed requests over about 3 seconds, no data lost | [postgres-failure.txt](evidence/postgres-failure.txt) |
| Scale Postgres to 0 | Argo CD restored it in 2 seconds | [postgres-failure.txt](evidence/postgres-failure.txt) |
| Drain a worker | 158 requests, 0 failed | [node-drain.txt](evidence/node-drain.txt) |
| Load test, 50 users | 28,073 requests, 0 failed, p95 552 ms, which misses the 300 ms target | [hpa-load.txt](evidence/hpa-load.txt) |
| Manual config change | Argo CD reverted it in 2 seconds | [drift.txt](evidence/drift.txt) |
| Race in `/identify` | Baseline code created 6 primaries from 20 parallel requests, new code creates 1 | Test `does not create duplicate primaries under concurrent requests` |

[GAMEDAY.md](GAMEDAY.md) explains each test.

## Limitations of this evidence

- Everything ran on one laptop. The numbers say nothing about cloud latency or real multi-zone failures.
- The load test missed the latency target. The cause is known, and the fix is not in this PR.
- The game day bad release was injected through a config flag, not a real code bug. The detection and rollback path is the same.
- Jaeger keeps traces in memory, so the traces quoted here are gone after a restart. The logs and the evidence files keep the trace ids.
- The cluster was set up step by step while building. `scripts/bootstrap.sh` then ran start to finish against that cluster in 26 seconds without errors, since every step is idempotent. A run on an empty machine was not tested.
