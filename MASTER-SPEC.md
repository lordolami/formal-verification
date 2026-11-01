# MIRAVERIF — Master Product Specification

**Product:** MiraVerif (working name; verify trademark/domain before external use) — the universal
claim-verification harness for backend systems. **Motto: No naked verdicts.**

**Status:** v1.0 master specification. Implementation proceeds phase-by-phase with evidence at each
phase; a phase is complete only when its acceptance checks run green on real artifacts.

---

## 1. Thesis

Software's bottleneck is moving from *writing behavior* to *demonstrating that behavior is safe*.
AI generation manufactures behavioral surface faster than humans can review it. Every backend
therefore needs a living, machine-checkable statement of what it promises — its claims — each
claim continuously re-executed against models, code, and live systems, with evidence, bounds,
assumptions, and residual risk attached.

MiraVerif is that statement, and the machine that keeps it honest.

**Credo:** *No naked verdicts.* The product never emits "correct", "secure", or "PASS" without
scope, method, bounds, environment, artifact hashes, assumptions, counterexamples, and uncovered
residuals in the same record.

## 2. The object model — the Claim Graph is the product

The central artifact is a versioned, content-addressed **claim graph**. Everything else —
models, probes, scanners, proof tools — plugs into it.

### 2.1 Node types

| Node | Core fields |
|---|---|
| SYSTEM | id, name, stack facts, criticality profile, discovery provenance (adapter versions + hashes) |
| COMPONENT | system ref, kind (service/db/queue/store/job/protocol), endpoints, datastores, owners |
| ACTOR | kind (anonymous/user/role/operator/service/peer), capabilities, credential classes, compromise states |
| BOUNDARY | from/to components-or-actors, enforced control, failure mode if control absent |
| ASSET | data classes, confidentiality/integrity/availability criticality |
| REQUIREMENT | text, source (regulator/customer/internal), trace links |
| HAZARD / THREAT | hazard: harm + severity class; threat: actor×asset×path (STRIDE-classified), linked CAPEC/ATT&CK technique class where honest |
| CLAIM | statement (natural + formal ref), scope, assumptions[], intolerable-if-false, owner, assurance level target |
| FORMAL-CLAIM | model ref (content hash), invariant/temporal/hyperproperty expression, property class (safety/liveness/hyper), bounds |
| CONTROL | implementation mechanism ref (file:symbol / policy rule / config key) |
| CHECK | method (see §4), tool + version, environment descriptor, input hashes, procedure (re-runnable), schedule |
| RUN | started/finished, seed, budgets, machine class, exit statuses, output digests |
| EVIDENCE | run ref, artifact digests, gate outcomes, bounds achieved, counterexamples[] |
| COUNTEREXAMPLE | minimized trace/probe sequence, replay command, severity, disposition (fix/waive-with-rationale), linked defect |
| ASSUMPTION | statement, justification, invalidators[], owner, review-by date |
| RESIDUAL | what is explicitly NOT covered (engine limits, unmodeled surfaces, timing/covert channels), accepted-by, expiry |
| WAIVER | claim/evidence ref, rationale, risk acceptance signature (human), expiry date — expired waiver = claim unsupported |
| SIGNOFF | human reviewer (≠ author), decision, date, scope of review |
| STALENESS | computed: any input hash change marks dependent claims STALE until re-executed |

### 2.2 Claim record (normative JSON shape, v1)

```json
{
  "id": "CLM-<DOMAIN>-<NNN>",
  "title": "Revoked refresh token never grants access on any surface",
  "domain": "auth",
  "class": "safety",
  "statement": "For every credential c and surface s: revoked(c) ⇒ ¬grants(s,c).",
  "scope": { "components": ["api"], "surfaces": ["http","realtime","sql-gateway"], "actors": ["user"] },
  "assumptions": ["ASM-CLOCK-01"],
  "intolerableIfFalse": true,
  "methods": ["model-adversarial", "implementation-probes", "mutation-adequacy"],
  "evidence": ["EVD-..."],
  "residuals": ["RES-CACHE-WINDOW: revocation propagation ≤5s measured, not zero"],
  "status": "SUPPORTED | STALE | UNSUPPORTED | REFUTED",
  "assuranceLevel": "FV-3"
}
```

A claim with no linked evidence is born **UNSUPPORTED**. A REFUTED claim (counterexample open)
blocks release profiles that include it. STALE claims render as warnings with the exact changed
input named. This is the entire honesty mechanism, and it is mechanical.

### 2.3 Claim formulas (how models state claims)

Claims are stated in an engine-neutral **claim formula** (predicate over states, over pairs of
states — transitions — or over *pairs of traces* for hyperproperties), then compiled to Quint
invariants/temporals today and to other engines tomorrow. Hyperproperties are first-class because
tenant isolation, information-flow bounds, and replica equivalence are two-trace claims; the
probe layer executes their differential form (two tenants/actors, interleaved attacks, observable
outputs compared). A claim whose class is `hyper` may not be marked SUPPORTED by model evidence
alone — differential conformance evidence is also required. This rule is normative.

### 2.4 Provenance & environment

Every RUN pins: model file SHA-256, target commit, engine name+version, adapter version, budgets,
seed, OS/arch, Java version (for Apalache), Node version, network/fs sandbox mode. Evidence that
cannot be re-executed bit-for-artifact is labeled NON-REPRODUCIBLE and can never raise a claim
above FV-2.

## 3. Assurance levels (replaces the single PASS)

| Level | Meaning | Requires |
|---|---|---|
| FV-0 Specified | Claim written, scoped, owned | claim record + assumptions + intolerable flag |
| FV-1 Modeled & tested | Model exists; simulation + scenario tests execute the claim | parse/typecheck/simulate/test green within stated bounds |
| FV-2 Bounded-verified | Exhaustive/bounded or SMT checking passed; properties mutation-adequate | verify gate green + mutation-adequacy ≥ profile threshold + no surviving critical mutants unexamined |
| FV-3 Implementation-conformant | Real system driven through model traces, security probes, fault points; behavior agrees | conformance runs green on target commit; coverage of claim's action surface ≥ profile threshold |
| FV-4 Adversarially assessed | Independent red-team/agent adversarial campaign + human review signoff | campaign report, reviewer ≠ author, counterexamples dispositioned |
| FV-5 Critical candidate | Full assurance case assembled for external assessor; tool-qualification evidence pack | GSN-structured case export, assessor-ready traceability, IV&V-compatible independence record |

Deliberately absent: any "certified" level. Certification is granted by domain authorities to
systems, never by this tool to itself — the case pack *supports* DO-333 / ISO 26262 / IEC 61508 /
CRA conformity work; it does not confer it.

## 4. Method library (what a CHECK can be)

1. `model-simulate` — Quint simulation with invariants (randomized trace exploration).
2. `model-verify` — Apalache (or TLC where applicable) bounded exhaustive checking over stated bounds.
3. `model-adversarial` — simulation/verification against a model whose `step` includes an explicit
   adversary action set (§6). Normative: any claim about authorization, isolation, or trust
   boundaries requires adversarial-method evidence, not merely cooperative-trace evidence.
4. `mutation-adequacy` — systematic model mutations (drop guard, invert predicate, skip commit,
   stale-read, duplicate effect…); each mutant MUST be killed by the property suite; survivors
   render the claim DECORATION-RISK and cap it at FV-1.
5. `implementation-probes` — black-box HTTP/driver probes generated from the claim (authZ matrix,
   BOLA swap, revocation race, fault points). Dual of the model check.
6. `trace-conformance` — implement
...[truncated 15821 chars]
## 5. The 14-stage pipeline (normative)

1. **Baseline & provenance** — pin repo commit, engine versions, tool versions, target identity.
2. **Discovery** — adapters extract entry points, datastores, actors, boundaries (`fv-discover`).
3. **Threat & hazard analysis** — six questions per surface (`SECURITY.md`); claims drafted.
4. **Claim formalization** — each claim gets scope, assumptions, formal ref, methods, owner.
5. **Property adequacy pre-check** — decision-duplication review; vacuity suspects rejected.
6. **Modeling** — one Quint model per critical behavior (starters in `assets/models/`).
7. **Execution gates** — parse → typecheck → simulate → test → verify (verify optional, honestly recorded).
8. **Mutation adequacy** — `fv-mutate`; survivors cap claims at FV-1.
9. **Implementation mapping** — every model action ↔ code path (file:symbol) or an explicit gap finding.
10. **Conformance & probes** — `fv-trace` (trace replay), `fv-probe` (live security probes), `fv-fault` (fault plans).
11. **Scan fusion** — `fv-scan` imports SARIF/OSV/secrets findings as hypotheses, never verdicts.
12. **Coverage** — `fv-cover` measures action/invariant/probe coverage per claim.
13. **Assurance assembly** — `fv-claims` computes levels/status/staleness; `fv-assurance` exports the case.
14. **Continuous re-execution** — CI templates + staleness watching; any input change re-opens claims.

## 6. Adversary & fault models

Normative: any claim about authorization, isolation, or trust boundaries requires
adversarial-method evidence, not merely cooperative-trace evidence. Adversary classes A0–A6
and fault schedule F1–F12 are defined in `SECURITY.md` §§2–3. Models must declare which
classes and F-points they exercise; claims inherit the union of their evidence — never more.

## 7. Evidence & reporting discipline

- Evidence formatVersion 2 everywhere: provenance (hashes, commit, versions, seed, budgets),
  gates with explicit status, verdict in {PASS, PASS-WITHOUT-EXHAUSTIVE, FAIL}.
- Reports lead with REFUTED/STALE/UNSUPPORTED claims, then per-claim levels, then residuals.
- An assurance case export (GSN-structured, JSON + Markdown) is the assessor-facing artifact.
- The words "certified", "guaranteed secure", and unqualified "correct" are prohibited in
  harness output. Levels are FV-0…FV-5; FV-5 is "candidate for external assessment".

## 8. Self-qualification

The harness may not claim detection capability it has not demonstrated. `fv-qualify` runs
seeded cases (verdict honesty, model corpus, mutant corpus, probe detection, claim-engine
cases, discovery/trace/fault/scan/cover/assurance fixtures) with recorded expectations.
A case that cannot execute is a failed case. Re-run on every harness or engine change.

## 9. The 38-claim security catalog

Defined in `SECURITY.md` §4 (CLM-AUTHZ-001…012, CLM-ISO-001…006, CLM-INT-001…008,
CLM-NET-001…006, CLM-PLAT-001…006) and shipped as machine-readable templates in
`assets/claims/` + `assets/domain-packs/`. A claim is adopted by copying its template into a
target's claim graph and binding scope, controls, and evidence.

## 10. Non-goals (binding)

- No certification, ever (§7). No frontend/UI verification. No replacing human judgment at
  FV-4 (sign-off) and FV-5 (external assessment).
- No engine lock-in: Quint/Apalache today behind adapters; the claim graph outlives engines.
  Exhaustive verification (Apalache/TLC) is **resource-gated**: it runs only under explicit
  resource budgets (timeout, step bound, model-size pre-check) because symbolic checking can
  saturate a workstation. Simulation, scenario tests, mutation, and probes are the default
  always-on layer; verify is opt-in per claim with recorded bounds.
