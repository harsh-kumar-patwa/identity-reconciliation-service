# Decisions and trade-offs

Each entry says what I chose, what I compared it with, and when the other option would be the better call.

## Application

**Advisory lock around `/identify`.** The baseline ran each query on its own. Twenty parallel requests for one new email created 6 primary contacts. Now the whole flow runs in one transaction and starts with `pg_advisory_xact_lock(1)`, so writes happen one at a time. The test `does not create duplicate primaries under concurrent requests` covers it. I considered `SERIALIZABLE` isolation, which needs retry logic on every conflict, and a unique constraint, which does not fit because a contact can have a null email or phone. The load test showed the cost. At about 94 requests per second, the median request waited 176 ms for the lock. A lock per email and phone value looks like the obvious fix, but it is not safe. One request can merge two groups while another adds a secondary to one of them, and the new row ends up pointing at a contact that is no longer primary. The safe next step is to lock the affected primary rows with `SELECT ... FOR UPDATE` in id order, so unrelated groups no longer wait for each other.

**Separate `/livez` and `/readyz`.** Liveness only checks that the process answers. Readiness also runs `SELECT 1` on Postgres. If liveness checked the database, a Postgres outage would make Kubernetes restart every api pod in a loop, which fixes nothing. With this split the pods stay up and drop out of the Service until the database is back.

**Graceful shutdown.** On SIGTERM the app marks itself not ready, stops accepting connections, finishes open requests, closes the database pool and exits. The pod also has a 5 second `preStop` sleep so the endpoints controller removes it from the Service before the app stops listening. `terminationGracePeriodSeconds` is 30 and the app forces an exit after 10 seconds, so Kubernetes never needs SIGKILL.

**Feature flag through config.** `FEATURE_NORMALIZE_INPUT` trims and lowercases emails and strips spaces from phone numbers. It is on in dev and off in prod values. A flag in the ConfigMap lets me turn the behaviour off without a new image. The Deployment has a `checksum/config` annotation, so changing the ConfigMap restarts the pods. Without it the pods would keep the old environment.

**Fault injection flag.** `CHAOS_ERROR_RATE` makes a share of `/identify` requests return 500. It is 0 by default. It exists to test the alerts and the rollback path.

## Container

**One image for the app and the migration.** The migration Job uses the same image with a different command. That way the schema and the code always come from the same commit. The cost is size. The image is about 800 MB because the Prisma CLI and its dependencies take about 210 MB. A separate migration image would make the app image smaller and add one more thing to build and keep in step.

**`node:22-alpine`, non-root.** Node 22 is the current LTS line. The container runs as the `node` user with a read-only root filesystem and only `/tmp` writable. Distroless would remove the shell and package manager, which makes debugging with `kubectl exec` harder. For a graded project I kept the shell.

## Kubernetes

**Deployment for the api, StatefulSet for Postgres.** The api keeps no state, so pods are interchangeable. Postgres needs the same volume every time its pod comes back, and the StatefulSet `volumeClaimTemplates` give it that. In a cloud setup I would use a managed database such as RDS instead of running Postgres in the cluster.

**Single Postgres replica.** Replication with failover needs an operator such as CloudNativePG. That is a lot to run and explain for this app. The trade-off is downtime when the pod restarts. The failure test measured about 3 seconds of 500 errors.

**QoS classes.** The api requests 100m CPU and 128 Mi and is limited to 500m and 256 Mi. That makes it Burstable, so it can use spare CPU during spikes. Postgres has requests equal to limits, which makes it Guaranteed. Under memory pressure the kubelet evicts Burstable and BestEffort pods before Guaranteed ones, and the database is the last thing I want evicted.

**Probe timings.** Readiness runs every 5 seconds and fails after 2 misses, so it reacts after about 10 seconds. The Postgres failure test showed a 3 second outage that readiness never saw, so 2 requests got a 500. A faster probe would catch short outages and would also flap on a single slow query. I kept 10 seconds.

**500 instead of 503 when the database is down.** The app returns 500 for any failed query. A 503 would tell clients to retry. This is a small follow-up I did not make.

**Spread across zones as a preference.** `topologySpreadConstraints` uses `ScheduleAnyway`. With `DoNotSchedule`, a drained worker would leave the replacement pod Pending, because only one zone is left. The drain test showed the downside. After `uncordon`, both api pods stayed on the same worker until the next rollout, because Kubernetes does not move running pods. The descheduler would fix that.

**PDB `minAvailable: 1` and HPA from 2 to 4 pods at 70% CPU.** Two pods is the smallest number that survives losing one. CPU is the signal metrics-server provides without extra parts. The load test showed its limit. At 50 users the HPA went to 4 pods and p95 rose to 552 ms, but the traces put 176 ms of the median request in the wait for the advisory lock and 0.3 ms in the real queries. More pods only added more requests to the lock queue. For this app, the HPA can't fix latency until the lock is narrower. See the load test entry in [GAMEDAY.md](GAMEDAY.md).

**HPA owns the replica count.** The Deployment has no `replicas` field when autoscaling is on, and the Argo CD app ignores `/spec/replicas`. Otherwise Argo CD and the HPA would keep overwriting each other.

## Networking and security

**Traefik instead of ingress-nginx.** The course used ingress-nginx. The Kubernetes project retired it in March 2026 and it no longer gets security fixes. Traefik reads the same `Ingress` resources, so the chart did not change apart from `ingressClassName`.

**Only public paths in the Ingress.** The Ingress routes `/identify`, `/version` and `/health` with `pathType: Exact`. `/metrics`, `/livez` and `/readyz` stay inside the cluster. Prometheus reaches `/metrics` through the Service.

**Self-signed TLS from a script.** It keeps the setup offline. cert-manager is the next step and would also handle renewal.

**Secrets outside git.** `scripts/create-secrets.sh` generates the database password and the Grafana password with `openssl rand` and stores them as Kubernetes Secrets. Nothing secret is in the repo, and gitleaks checks the whole history on every push. Sealed Secrets or External Secrets would let the secret definitions live in git too. That matters once more than one person runs the cluster.

**Least privilege.** The api uses its own ServiceAccount with `automountServiceAccountToken: false`, because the app never calls the Kubernetes API. The CI workflow defaults to `contents: read`. Only the `image` job gets `packages: write` and only `release` gets `contents: write`.

**Actions pinned to commit SHAs.** A tag such as `v4` can be moved to point at different code. trivy-action had exactly that happen in March 2026. Pinning to a SHA means the workflow runs the code I reviewed. The cost is manual updates, which Dependabot can automate.

## Delivery

**GitHub Actions for CI, Argo CD for CD.** The cluster runs on a laptop, so GitHub cannot reach it to run `kubectl apply`. Argo CD runs inside the cluster and pulls from git, which also keeps cluster credentials out of CI. With a cloud cluster, a push-based deploy from CI would work. I would still keep Argo CD for drift detection.

**Manual approval before release.** Tests and scans run on every push. The step that changes what runs in the cluster waits for a human on the GitHub `dev` environment. For a team with good test coverage, dev could deploy automatically and the approval could move to prod.

**Rolling update instead of blue-green or canary.** Rolling with `maxUnavailable: 0` and readiness gating gives zero-downtime deploys with no extra tooling. Blue-green doubles the pods during a release and needs traffic switching. Canary needs Argo Rollouts or a service mesh plus automated analysis. With one service and a manual approval step, rolling plus fast rollback by `git revert` is enough. If a bad release reaching all users at once became the main risk, I would add Argo Rollouts with a Prometheus analysis on the error ratio.

**One live environment.** Dev runs on the cluster. `values-prod.yaml` holds the prod differences: 3 to 8 replicas, larger requests, 10 Gi storage, 10% trace sampling and the feature flag off. A second Argo CD application pointing at it would add prod. One chart with small values files means the environments cannot drift apart the way copied YAML would.

**Bot commit for the image tag.** The `release` job commits as `github-actions[bot]`. Git stays the only source of truth, and the history shows which image ran when. Argo CD Image Updater can do the same without CI write access to the repo.

## Observability

**SLO of 99.5% successful `/identify` requests and p95 under 300 ms.** The success SLI counts 5xx responses only, because a 400 is the client's mistake. A 99.5% target over 30 days gives an error budget of about 3.6 hours of full outage.

**Burn-rate alerts with two windows.** The fast alert fires when the error ratio is above 14.4 times the budget rate over both 5 minutes and 1 hour. At that rate the monthly budget is gone in about 2 days. The slow alert uses 6 times over 30 minutes and 6 hours. Requiring both windows avoids paging on a short blip and still catches a sustained problem in minutes.

**Bounded metric labels.** The `route` label uses the matched route pattern, never the raw URL, so a scan of random paths cannot create unlimited time series. Unmatched paths share one `unmatched` label.

**Traces sampled at 100% in dev and 10% in prod.** At low traffic every trace is useful. At prod volume, 10% keeps storage down. The sampler is parent-based, so a trace is kept or dropped as a whole.

**Alloy instead of Promtail.** Promtail is deprecated. Alloy is its replacement from Grafana.
