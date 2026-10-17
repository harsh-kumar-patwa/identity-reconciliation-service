# Game day

Failure tests run on 17 October 2026 against the kind cluster. Each one follows the same order: symptom, hypothesis, evidence, change, verification. Raw command output is in [evidence/](evidence/).

## 1. Bad release

Raw output: [evidence/gameday-bad-release.txt](evidence/gameday-bad-release.txt)

**Setup.** Commit `e812f45` set `chaosErrorRate: "0.3"` in `values-dev.yaml`, which makes 30% of `/identify` requests return 500. It stands in for a release with a bug. A k6 run with 10 users sent steady traffic.

| Time, UTC | Event |
|---|---|
| 18:04:07 | Argo CD starts the sync of `e812f45` |
| 18:05:25 | Rollout complete, all api pods run with the flag |
| 18:05:59 | 1 minute error ratio at 30.7% |
| 18:06:35 | `IdentifyErrorBudgetSlowBurn` pending |
| 18:08:06 | `IdentifyErrorBudgetFastBurn` firing, 2 minutes 41 seconds after the rollout finished |
| 18:08:39 | Revert commit `a543243` ready |
| 18:09:56 | Revert pushed |
| 18:10:06 | Argo CD synced `a543243`, flag back to 0 |
| 18:11:19 | 1 minute error ratio at 0 |
| 18:15:07 | Fast-burn alert resolved |

**Symptom.** The fast-burn alert fired. The dashboard showed the 5 minute error ratio at 30% and the 1 hour ratio climbing past 7.2%, which is 14.4 times the 0.5% budget rate.

**Hypothesis.** Errors started right after a sync, so the release is the first suspect.

**Evidence.**

- Argo CD history showed `e812f45` deployed at 18:04:07, and `git show e812f45` showed one changed line, `chaosErrorRate: "0.3"`.
- Loki returned error lines with the message `chaos: injected failure`.
- The `trace_id` from one of those lines opened a Jaeger trace of 1.7 ms with status 500 and no `pg.query` spans. The request failed before it reached the database, which rules out Postgres.

**Change.** `git revert e812f45`, pushed as `a543243`. No `kubectl` command was needed. Argo CD applied the revert, and the `checksum/config` annotation made the pods restart with the new ConfigMap.

**Verification.** The 1 minute error ratio was 0 at 18:11:19. The fast-burn alert resolved at 18:15:07, once the 5 minute window no longer held the bad period. The smoke test passed. The slow-burn alert kept firing for longer because its 6 hour window still held the bad minutes. That alert opens a ticket and does not page.

**Impact.** About 9,800 of 49,000 `/identify` requests failed over roughly 5 minutes. At this traffic level that is about 1% of a month's error budget.

**Mitigation, recovery, resolution.** The revert was the mitigation and it stopped user impact about a minute after the push. Recovery was complete at 18:11:19, with all pods ready and errors at 0. In a real incident, resolution would be a fix with a test, released through the normal pipeline.

**What I would change.** Detection took under 3 minutes, but the rollback still needed a human to push. With Argo Rollouts and an analysis step on `identify:error_ratio:rate5m`, a canary at 10% of traffic would have been rolled back automatically, and only about 3% of requests would have failed instead of 30%.

## 2. Postgres pod lost

Raw output: [evidence/postgres-failure.txt](evidence/postgres-failure.txt)

**Symptom.** `kubectl delete pod postgres-0` while a request ran every second.

**Hypothesis.** The StatefulSet recreates the pod with the same volume, so data survives. Readiness takes the api pods out of the Service if the database is gone for more than 10 seconds.

**Evidence.** Two requests returned 500 over about 3 seconds. The new `postgres-0` was ready at 17:50:49. The api endpoints stayed ready the whole time, because the outage was shorter than the readiness window. The contact count was 25 before and 26 after, the extra row being a test request.

A second run scaled the StatefulSet to 0. Argo CD self-heal set it back to 1 within 2 seconds, and requests returned 200 again 3 seconds after the scale-down.

**Change.** None needed. The test showed that a short database restart gives a few seconds of 500s. Returning 503 instead of 500 would tell clients to retry. That change is listed in DECISIONS.

**Verification.** The row count matched, `/readyz` returned 200 and the smoke test passed.

## 3. Node drain

Raw output: [evidence/node-drain.txt](evidence/node-drain.txt)

**Symptom.** `kubectl drain identity-worker2` while a loop sent 5 requests per second, standing in for a node upgrade.

**Hypothesis.** The PDB allows one api pod to be evicted at a time, and the other pod keeps serving.

**Evidence.** The PDB showed 1 allowed disruption before the drain. The drain evicted the api pod on `identity-worker2`, and the Deployment started a replacement on `identity-worker`. The loop recorded 158 successful requests and 0 failures.

**Change.** None needed. One follow-up came out of it. After `kubectl uncordon`, both api pods stayed on one worker, because Kubernetes does not move running pods. The next rollout or the descheduler would spread them again.

**Verification.** `kubectl rollout status deploy/api` succeeded and the node was uncordoned.

## 4. Load test

Raw output: [evidence/hpa-load.txt](evidence/hpa-load.txt)

**Symptom.** k6 ramped to 50 users for 3 minutes. p95 latency reached 552 ms against a 300 ms target. No request failed, out of 28,073.

**Hypothesis.** First guess was CPU, because CPU sat at 310% of the request and the HPA had reached its maximum of 4 pods.

**Evidence.** Jaeger traces from the test grouped by SQL statement told a different story.

| Statement | Count | p50 | Max |
|---|---|---|---|
| `SELECT pg_advisory_xact_lock(1)` | 394 | 176 ms | 279 ms |
| Contact queries | 4,701 | 0.3 ms | 71 ms |

The time goes into waiting for the global advisory lock. Requests queue behind it, so more pods add more waiters and do not add throughput.

**Change.** Not made before the deadline. A lock per email and phone value is not safe, as DECISIONS explains. The next step is to lock the affected primary rows with `SELECT ... FOR UPDATE` in id order, so requests for unrelated contact groups do not wait for each other.

**Verification.** For the future fix, rerun `scripts/loadtest.js` and compare the p95 and the lock span durations with this run.

## 5. Drift

Raw output: [evidence/drift.txt](evidence/drift.txt)

**Symptom.** `kubectl patch configmap api-config` changed `LOG_LEVEL` from `debug` to `error` by hand.

**Hypothesis.** Argo CD self-heal sees the live object differ from git and puts it back.

**Evidence and verification.** The value was `debug` again 2 seconds later.
