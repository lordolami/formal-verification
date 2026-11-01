# formal-verification in any CI

Principles (from MASTER-SPEC Stage 14):

1. **Every claim re-executes or goes visibly STALE.** The claim gate is
   `fv-claims status` — it exits 1 when an intolerable claim is REFUTED.
   STALE claims print their reasons; decide per-repo whether STALE fails PRs
   (recommended for intolerable claims).
2. **Budgets are explicit.** Simulation samples/steps, probe timeouts, and
   mutation scope are config, not vibes. Record them; evidence carries them.
3. **Exhaustive verify is opt-in and resource-gated.** Apalache/TLC can
   saturate a runner. Run it in a dedicated job with Java 21, small step
   bounds, per-model size pre-checks, and hard timeouts — never as a
   surprise inside the PR fast lane.
4. **Evidence is an artifact.** Upload `.formal-verification/evidence/` on
   every run, pass or fail. Counterexamples you throw away will recur.
5. **Exit-code discipline.** 0 = PASS, 3 = PASS-WITHOUT-EXHAUSTIVE (tested,
   not proven — acceptable only where policy says so), 1 = FAIL, 2 = setup
   error. A pipeline that treats 3 as 0 is lying; one that treats it as 1
   without Java is just slow. Write the policy down.
6. **Self-qualify on harness changes.** `fv-qualify` runs on changes to the
   harness or its engine pin (and weekly), never silently skipped.

Minimal shell sequence (adapt paths):

```sh
node $FV/fv-run.js --model .formal-verification/models/token.qnt --repo . --seed 1 --skip-verify
node $FV/fv-mutate.js --model .formal-verification/models/token.qnt --repo . --seed 1 --invariants noBadGrant
node $FV/fv-claims.js status --repo . --out .formal-verification/evidence/claims-status.json
# live staging only, with safety law satisfied:
node $FV/fv-probe.js --probes .formal-verification/probes/backend-security-probes.json --base "$STAGING_URL" --pin-host staging.internal --allow-mutating
node $FV/fv-assurance.js --repo .   # refresh the case on main
```
