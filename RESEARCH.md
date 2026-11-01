# Research base — universal assurance harness (2026)

Firsthand research synthesis. Facts are labeled by confidence. Items marked **[VERIFY]** must be
re-checked against primary sources before use in marketing, legal, or certification claims — this
document is engineering input, not a citable bibliography. Date anchored: November 2026.

## 1. The verified-systems credibility gallery

These systems define what "proof" actually means in industry. The harness must never claim more
than they achieved, and must always state proof boundaries the way they do.

| System | What was proven (boundary) | Effort signal |
|---|---|---|
| seL4 microkernel | Functional correctness kernel C → spec; later security (integrity/confidentiality), WCET, binary translation validation | ~200k lines proof, ~20 person-years (original campaign) |
| CompCert | Semantics preservation C → assembly for a defined C subset | Multi-year INRIA effort; found the only C compiler bugs in its class in testing |
| HACL* / EverCrypt | Verified crypto primitives (Curve25519, ChaCha-Poly, etc.) in Firefox, Linux kernel, mbedTLS | Fiat Cryptography generates field arithmetic in BoringSSL/Chrome; AWS s2n HMAC verified with SAW |
| AWS Zelkova | SMT (Z3) analysis of IAM policies — "is this policy at least as permissive as that one" ~200M policy analyses/day class scale | Backes et al. 2018; Zelkova uses SMT encoding |
| AWS Cedar | Policy language designed for verification: SMT-based symbolic evaluation in the Cedar authorization engine, Lean formalization, differential random testing vs reference | Open source (Apache-2.0) |
| Google Zanzibar / SpiceDB | ReBAC consistency; SpiceDB checks schema consistency | Consistency semantics (zookies) — not full proof, strong modeling |
| Airbus Astrée | Sound abstract interpretation proving absence of runtime errors in flight-control C | DO-178B/DO-333 context; false alarms tuned to near-zero on their codebase |
| FoundationDB | Deterministic simulation testing (custom, not proof) | Industry's canonical "simulation finds what testing misses" case |
| MongoDB / Serde? | MongoDB: TLA+ designs (Raft, transactions). Tickets of TLA+ specs public | Design-level, not code proof |
| DARPA HACMS (Galois) | Clean-slate verified control software; red team failed to achieve mission compromise | **Red-team outcome details are report-summarized; do not over-quote specific penetration claims [VERIFY]** |

**Lesson:** every credible effort states (a) the property, (b) the boundary (language/subset/model),
(c) the assumptions (hardware, compiler, spec review). MiraVerif copies that discipline to backends.

## 2. The engine world (division of labor — no single engine suffices)

- **Explicit-state model checking** — TLC (TLA+), Quint simulator, Coyote (concurrency). Finds
  shallow bugs fast; state explosion caps depth. **[FACT — established literature]**
- **Symbolic checking** — Apalache (SMT-backed TLA+/Quint), PDR/IC3. Deeper bounds; struggles
  with nonlinear arithmetic, large data words. **[FACT]**
- **SMT** — Z3/cvc5. The workhorse beneath Zelkova, Cedar analysis, Dafny, F*, Kani. **[FACT]**
- **Deductive proof** — Lean 4 (explosive ecosystem growth 2023–2026, Mathlib), Coq, Isabelle,
  Dafny, Verus (Rust), F*, SPARK. Highest assurance, highest cost. AI-assisted proving accelerated:
  AlphaProof (IMO silver, DeepMind 2024 — **[FACT]**), DeepSeek-ProverV2, Lean Copilot, commercial
  products emerging. **[VERIFY current leaderboard specifics before citing]**
- **Code-level symbolic tools** — Kani (Rust model checker, used by Firecracker/AWS), CBMC (C),
  Frama-C, SAW (equivalence of binaries/spec), KeVM/Runtime Verification K framework.
- **Protocol provers** — Tamarin, ProVerif, CryptoVerif: Dolev-Yao symbolic crypto protocols.
  They prove protocol *logic under symbolic assumptions*, not implementations. **[FACT]**
- **Consistency checkers** — Jepsen/Elle (black-box transactional-anomaly detection via cycle
  inference), Knossos lineage. Finds real database bugs without any model of internals. **[FACT]**

**Lesson:** the harness is an *orchestrator* with an honest capability map per engine, not a
single-engine religion. Quint is the modeling front-end; the kernel must accept evidence from
SMT outputs, proof certificates, checker reports, and differential fuzzer campaigns.

## 3. The security-testing world

- **OWASP API Security Top 10 (2023)** — API1 BOLA, API2 Broken Authentication, API3 Broken
  Object Property Level Authorization (mass assignment/excess data), API5 Broken Function Level
  Authorization, API8 Security Misconfiguration etc. BOLA/IDOR is #1 because tools cannot test
  business authorization semantics automatically. **[FACT]**
- **RESTler** (Microsoft, open source) — infers producer-consumer dependencies from OpenAPI and
  fuzzes *stateful sequences*, finding mainly server errors (500s) and some access-control bugs.
  Competitors: Schemathesis (property-based, Hypothesis), EvoMaster (white-box, academic),
  Morest, RestTestGen. None generate *semantic authorization matrices* — they don't know who
  should see what. **[FACT + INFERENCE: this gap is the opening]**
- **The autonomous-pentester shock (2025)** — XBOW reached #1 on HackerOne's US leaderboard —
  the first autonomous system to top human researchers — and raised ~$75M Series B (June 2025,
  Altimeter/Sequoia). **[FACT per company reporting; leaderboard methodology disputed by some
  researchers — VERIFY wording before external use]** NodeZero (Horizon3.ai), Pentera, Cymulate
  occupy continuous attack simulation. They attack like a *generalist adversary*, not like a
  *specification aware of the system's own invariants* — this harness attacks with the system's
  own claims as the weapon. **[INFERENCE]**
- **Secrets/dependency/SAST** — Semgrep/CodeQL/Snyk-class tools are necessary but pattern-bound;
  their known false-negative space is exactly semantic authorization, isolation, and cross-surface
  inconsistency. **[FACT-adjacent, widely documented limitation]**
- **Jepsen discipline** — Elle finds anomalies in production databases black-box with no internal
  model: properties stated externally (anomaly shapes), adversaries as schedules, evidence as
  history graphs. Direct inspiration for our integrity-differential probe. **[FACT]**

## 4. The regulated world (demand tailwinds)

- **DO-178C/DO-333** — formal analysis may substitute for some testing objectives with soundness
  caveats; **DO-330** qualifies tools by Tool Qualification Level. **DO-326A/ED-202A** — airworthiness
  security. **[FACT]**
- **ISO 26262 / IEC 61508 / IEC 62304 / EN 50716 (rail, supersedes EN 50128)** / **ECSS** /
  **IEC 62443** (industrial security SLs) / **DO-254** (hardware). Each: integrity levels
  (ASIL/SIL), evidence rigor proportional to level, tool confidence, independent assessment. **[FACT]**
- **EU Cyber Resilience Act** — Regulation (EU) 2024/2847: essential cybersecurity requirements
  for products with digital elements; vulnerability reporting from Sep 2026, main obligations
  **11 Dec 2027**; penalties up to €15M or 2.5% global turnover (aligned with product-safety
  enforcement). Conformity via self-assessment for most, notified body for important/critical
  classes. **[FACT — VERIFY dates/penalty figures before external citation]**
- **NIS2**, **DORA** (financial operational resilience, applies Jan 2025), **PCI DSS 4.0.1**,
  **US EO 14028 / NIST SSDF (SP 800-218) / SLSA** — buyers must *evidence* practices, increasingly
  in machine-readable form. **[FACT]**
- **Assurance-case notation** — Goal Structuring Notation (GSN, OMG SACM as interchange), CAE.
  Regulators accept structured argument+evidence, not tool logos. Confidence-in-argument research
  (Bloomfield, Rushby) supplies the intellectual core: assurance *deficits* must be explicit. **[FACT]**

## 5. The AI shock (why now)

AI code generation collapses implementation cost while verification cost stays constant or rises
(review surface grows). Every team shipping AI-generated backend code accumulates *unreviewed
behavioral surface*: schemas, rules, endpoints, jobs, sync paths — with no human who can enumerate
what the code promises. Public reporting through 2025 shows AI tooling accounting for a large and
rising share of committed code at major vendors **[VERIFY any specific percentage before use]**,
and Google's DORA 2025-era research links AI adoption to delivery instability without compensating
verification practices **[VERIFY report/year]**. The bottleneck of software is becoming
*demonstrating that behavior is safe* — which is precisely a machine-checkable-claims problem,
and the reason a universal harness matters now.

## 6. The existing tool landscape (honest map)

| Neighbor | Strength | Structural blind spot |
|---|---|---|
| Galois / Runtime Verification / Zellic / Trail of Bits | Deep human expertise, audits | Human-scaled, point-in-time engagements |
| Certora | Real smart-contract prover product | Single domain (EVM contracts) |
| Informal Systems | Quint/Apalache creators | Tools + services, not continuous assurance |
| Antithesis | Brilliant deterministic fault testing; reports of bugs found in tier-1 systems **[VERIFY specific claims]** | Finds crashes/inconsistencies; no semantic authZ/isolation claims; hypervisor model |
| 42Crunch | OpenAPI security audit posture, CI gates | Spec-pattern checks (OWASP), not behavioral proofs |
| Akto/Escape-style API security | Inventory + DAST-ish probes | Pattern probes, no model, no invariant weaponization |
| Semgrep/CodeQL/Snyk | Massive adoption, fast | Pattern/taint bound; cannot state tenant-isolation semantics |
| Drata/Vanta | Evidence collection automation | Collects attestations/policies; never executes a claim |
| AI QA tools (Momentic-class) | Fast UI test generation | Frontend, click-paths, no backend semantics |
| XBOW-class autonomous pentesters | Real-world attack validation at scale | Attacker-model generalist; no knowledge of intended invariants; findings not tied to a durable claim ledger |

**The unoccupied position [INFERENCE]:** none of them maintains a *living, versioned claim graph*
for a backend — claims spanning correctness, authorization, isolation, durability, recovery and
security — continuously re-executed on every change with model proofs, model adversarial
exploration, and implementation probes fused into one evidence ledger. That fusion is what this
harness builds.

## 7. Spec-quality science (the part amateurs skip)

- **Vacuity** (Beer et al., IBM) — a property can hold because its antecedent is never true.
  Antidote shipped since the 90s in high-end flows: coverage of property constructs, formal
  property coverage. We implement *mutation adequacy* instead — practical, engine-agnostic.
- **Spec mutation** — mutate the model (drop revocation, allow overflow, skip commit); the
  property suite must kill mutants. Survivors = decoration. **[FACT as research direction]**
- **Hyperproperties** (Clarkson & Schneider 2008/2010) — properties of *sets of traces*
  (noninterference, observational determinism, tenant isolation). Not expressible as single-trace
  invariants; checked via self-composition/product programs or *differential execution* — run two
  tenants, attack across, diff observable behavior. This is why the probe layer is not optional:
  isolation is proven in the model by construction *and* corroborated by differential probes. **[FACT]**
- **Traceability science** — regulated industries learned REQ→hazard→control→test→evidence
  chains the hard way (NASA/JPL institutional practice). Unlinked claims are opinions. **[FACT]**

## 8. Failure archaeology (why verification efforts die — and the counter-designs)

1. **Proof as manual labor.** Point-in-time human audits go stale the day they ship.
   → Counter-design: claims execute mechanically in CI; humans author claim strategy only.
2. **Specification bottleneck.** Requiring hand-written formal specs before any value.
   → Models start from a proven starter corpus; scope/claim approval is the human gate.
3. **Model-code drift.** A beautiful proof about code that shipped yesterday.
   → Staleness is computed: any input hash change marks dependent claims STALE; probes bind
   models to the running system.
4. **No CI gravity.** A tool outside the pull-request loop becomes shelfware.
   → Every check is a CI-native command with budgets and stable exit codes.
5. **Binary verdict marketing.** "Formally verified" claims that dissolve under expert scrutiny,
   destroying the only asset that matters: credibility.
   → No Naked Verdicts; FV-0…FV-5 levels; residuals always named; certification never claimed.
6. **Single-engine religion.** Betting everything on one solver's roadmap/institutional home.
   → Engine-adapter architecture with an explicit capability matrix; Quint first, never Quint-only.
