# Runbook

Each section follows the same order. Check the symptom, form a hypothesis, collect evidence, apply a fix, then confirm recovery.

## What healthy looks like

These are the values from the "Identity service" Grafana dashboard at normal load.

| Signal | Healthy value | Where to look |
|---|---|---|
| Success ratio over 1 hour | 100%, and never below 99.5% | Top-left stat panel, or `1 - identify:error_ratio:rate1h` |
| p95 latency of `/identify` | Around 20 to 30 ms, well under the 300 ms target | `identify:latency_p95:5m` |
| Ready api pods | 2, or more while the HPA has scaled up | `kube_deployment_status_replicas_available{deployment="api"}` |
| HPA replicas | 2 when idle | "Api replicas (HPA)" panel |
| Postgres | `postgres-0` Running and 1/1 ready | `kubectl -n identity get pods` |
| Argo CD | `Synced` and `Healthy` | `kubectl -n argocd get app identity-dev` |
| Firing alerts | None apart from the always-on `Watchdog` | Alertmanager, or `ALERTS{alertstate="firing"}` in Prometheus |

A quick check from a terminal:

```bash
kubectl -n argocd get app identity-dev
kubectl -n identity get pods,hpa
./scripts/smoke.sh
```

## High error rate

Alerts `IdentifyErrorBudgetFastBurn` and `IdentifyErrorBudgetSlowBurn`.

1. Check scope. On the dashboard, see whether the 5xx share rose for all pods or one, and when it started.
2. Check for a recent change. `kubectl -n argocd get app identity-dev -o jsonpath='{.status.history[-1]}'` shows the last synced commit and when it happened. `git log -3 -- deploy/` shows what changed. An error spike that starts within minutes of a sync points at the release.
3. Read the errors. In Grafana Explore, query Loki with `{namespace="identity", app="api"} | json | level >= 50`. Each line has a `trace_id`. Click it to open the trace in Jaeger and see which span failed.
4. Check the database. If the errors mention the connection or the pool, go to [Postgres down](#postgres-down).
5. Mitigate. If a release caused it, revert the release commit and push. Argo CD deploys the previous version within about 3 minutes. If `CHAOS_ERROR_RATE` is above 0 in `values-dev.yaml`, set it back to 0.
6. Confirm recovery. The 5 minute error ratio drops to 0, the fast-burn alert resolves, and `scripts/smoke.sh` prints OK. `/version` shows the version you expect.

## High latency

Alert `IdentifyLatencyHigh`.

1. Check load. If requests per second rose at the same time, look at the HPA panel. If the HPA is at `maxReplicas` and CPU is still above 70%, the service is out of capacity.
2. Check CPU throttling. CPU per pod near the 500m limit means the pods are throttled.
3. Check the database. In Jaeger, sort `/identify` traces by duration. If the time sits in the `pg.query` spans, the database or the advisory lock is the bottleneck. Many short requests queued behind the lock show as long waits on the first `SELECT`.
4. Mitigate. Raise `autoscaling.maxReplicas` or the CPU limit in the values file and push. If the lock is the bottleneck, more api pods will not help.
5. Confirm recovery. p95 goes back under 300 ms and stays there for 10 minutes, and the alert resolves.

## Api pods not ready

Alert `ApiPodsNotReady`.

1. `kubectl -n identity get pods -l app=api` and `kubectl -n identity describe pod <name>`. Look at the events.
2. `ImagePullBackOff` means the tag in `values-dev.yaml` does not exist in GHCR or the package is private.
3. `CrashLoopBackOff` means the app exits on start. `kubectl -n identity logs <pod> --previous` shows why.
4. Running but not ready means `/readyz` fails, which nearly always means the app cannot reach Postgres. Go to [Postgres down](#postgres-down).
5. Pending means the scheduler cannot place the pod. The events say whether CPU, memory or a node selector is the problem.
6. Confirm recovery. The Deployment shows all pods ready and the smoke test passes.

## Postgres down

Alert `PostgresDown`.

1. `kubectl -n identity get pod postgres-0` and `kubectl -n identity describe pod postgres-0`.
2. If the pod is Pending, check that the PVC `data-postgres-0` is Bound with `kubectl -n identity get pvc`.
3. If it crashes, read `kubectl -n identity logs postgres-0`. A full disk shows up there.
4. If the StatefulSet was scaled to 0 by hand, Argo CD scales it back within seconds. Check with `kubectl -n argocd get app identity-dev`.
5. Confirm recovery. `postgres-0` is 1/1 ready, the api pods turn ready again, and a row count matches what was there before:

```bash
kubectl -n identity exec postgres-0 -- psql -U app -d identity -tc 'select count(*) from "Contact"'
```

## Roll back a release

1. Find the release commit, for example `Deploy sha-abc1234 to dev`, with `git log --oneline -- deploy/helm/identity-service/values-dev.yaml`.
2. `git revert <commit>` and push.
3. Watch `kubectl -n argocd get app identity-dev -w` until it is Synced and Healthy at the new commit.
4. Check `./scripts/smoke.sh`. The version line should show the previous tag.

## Incident roles and follow-up

For a real incident, one person leads and posts status updates while others investigate. Keep three things apart.

- Mitigation stops the user impact, for example a rollback.
- Recovery brings the system back to its normal state, for example pods ready and error ratio at 0.
- Resolution removes the cause, for example a code fix with a test, so it does not happen again.

After recovery, write a short note covering timeline, impact in error budget, cause and follow-up actions. [GAMEDAY.md](GAMEDAY.md) has examples from the failure tests.
