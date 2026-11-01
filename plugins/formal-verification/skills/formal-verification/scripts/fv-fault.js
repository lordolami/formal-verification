// fv-fault: fault-injection planning + plan-evidence checking (MASTER-SPEC
// method: fault-injection; fault schedule F1-F12 in SECURITY.md §3).
//
// Fault injection is the one method that must touch the real system at its
// weakest moments. Doing it ad hoc is how staging dies and claims lie.
// fv-fault therefore separates:
//   plan  — validated JSON plan: per claim, which F-points execute, at which
//           action boundary, with what kill/recovery procedure, safety class,
//           and expected post-condition. Planning is offline and safe.
//   check — verifies a filled execution record (performed by your runner/ops
//           automation against staging) satisfies the plan: every declared
//           F-point has an outcome, post-conditions observed, recovery timed.
// fv-fault itself never kills processes or touches a live system. A plan
// with zero F-points for a durability claim is a FAIL, not a plan.
//
// Usage:
//   node fv-fault.js plan  --plan <fault-plan.json> [--repo <dir>] [--out <normalized.json>]
//   node fv-fault.js check --plan <fault-plan.json> --record <execution-record.json> [--out <evidence.json>]
// Exit: 0 plan/record sound, 1 unsound, 2 usage/setup.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

const FPOINTS = {
  F1: "kill-before-commit", F2: "kill-after-commit-before-ack", F3: "kill-after-ack-before-response",
  F4: "duplicate-delivery", F5: "reorder-delay-beyond-window", F6: "partition",
  F7: "clock-skew-lease-window", F8: "disk-full-at-staged-boundary", F9: "torn-corrupt-artifact",
  F10: "dependency-error", F11: "dependency-successful-lie", F12: "rollback-across-acknowledged",
};
const SAFETY_CLASSES = ["read-only", "staging-destructive", "production-windowed"];

function parseArgs(argv) {
  const a = { cmd: argv[2] };
  for (let i = 3; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--plan") a.plan = next();
    else if (t === "--record") a.record = next();
    else if (t === "--repo") a.repo = next();
    else if (t === "--out") a.out = next();
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!a.cmd || !a.plan) throw new Error("usage: fv-fault.js plan|check --plan <file> [--record <file>]");
  return a;
}

function validatePlan(plan) {
  const problems = [];
  if (!plan || plan.formatVersion !== 1) problems.push("plan formatVersion must be 1");
  if (!plan.target) problems.push("plan.target required (name the system+environment; 'production' demands safetyClass production-windowed + owner signoff field)");
  if (!Array.isArray(plan.cases) || plan.cases.length === 0) problems.push("plan.cases must be a non-empty array");
  for (const c of plan.cases || []) {
    const id = c.id || "(unnamed case)";
    if (!c.claim) problems.push(`${id}: claim required (fault evidence must name its claim)`);
    if (!Array.isArray(c.fpoints) || c.fpoints.length === 0) problems.push(`${id}: at least one F-point required`);
    for (const f of c.fpoints || []) if (!FPOINTS[f]) problems.push(`${id}: unknown F-point ${f} (F1-F12)`);
    if (!c.boundary) problems.push(`${id}: boundary required (the exact action/stage where the fault lands)`);
    if (!c.procedure) problems.push(`${id}: procedure required (how the fault is induced + how recovery is driven)`);
    if (!c.expect) problems.push(`${id}: expect required (post-condition that must be observed)`);
    if (!SAFETY_CLASSES.includes(c.safetyClass)) problems.push(`${id}: safetyClass must be one of ${SAFETY_CLASSES.join(", ")}`);
  }
  if (plan.target && /prod/i.test(String(plan.target.environment || ""))) {
    for (const c of plan.cases || []) {
      if (c.safetyClass === "staging-destructive") problems.push(`${c.id}: staging-destructive procedure aimed at a production target`);
    }
    if (!plan.ownerSignoff) problems.push("production-target plans require ownerSignoff");
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const startedAt = lib.nowIso();
  const planFile = path.resolve(args.plan);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));

  if (args.cmd === "plan") {
    const problems = validatePlan(plan);
    const normalized = { ...plan, validatedAt: startedAt, fpointGlossary: FPOINTS, problems };
    const out = args.out || path.join(repo, ".formal-verification", "faults", "plan.normalized.json");
    lib.writeJson(out, normalized);
    console.log(JSON.stringify({
      out, cases: (plan.cases || []).length,
      fpointsCovered: [...new Set((plan.cases || []).flatMap((c) => c.fpoints || []))],
      problems,
      verdict: problems.length ? "FAIL" : "PASS",
    }, null, 2));
    process.exit(problems.length ? 1 : 0);
  }

  if (args.cmd === "check") {
    if (!args.record) throw new Error("check requires --record <execution-record.json>");
    const planProblems = validatePlan(plan);
    const record = JSON.parse(fs.readFileSync(path.resolve(args.record), "utf8"));
    const outcomes = new Map(); // caseId -> Map(fpoint -> outcome)
    for (const o of record.outcomes || []) {
      if (!outcomes.has(o.case)) outcomes.set(o.case, new Map());
      outcomes.get(o.case).set(o.fpoint, o);
    }
    const results = [];
    for (const c of plan.cases || []) {
      for (const f of c.fpoints || []) {
        const o = outcomes.get(c.id) && outcomes.get(c.id).get(f);
        if (!o) results.push({ case: c.id, claim: c.claim, fpoint: f, ok: false, detail: "no execution outcome recorded for this F-point" });
        else if (o.postConditionObserved !== true) results.push({ case: c.id, claim: c.claim, fpoint: f, ok: false, detail: `post-condition not observed: ${o.detail || "(no detail)"}` });
        else results.push({ case: c.id, claim: c.claim, fpoint: f, ok: true, detail: o.detail || "post-condition observed", recoveryMs: o.recoveryMs ?? null });
      }
    }
    const failed = results.filter((r) => !r.ok);
    const verdict = planProblems.length || failed.length ? "FAIL" : "PASS";
    const evidence = {
      tool: "formal-verification/fv-fault",
      formatVersion: 2,
      target: plan.target || null,
      planFile, planSha256: lib.sha256File(planFile),
      startedAt, finishedAt: lib.nowIso(),
      quintExpected: null, quintActual: null, setupError: null,
      provenance: { gitCommit: lib.gitCommit(repo), node: process.version, platform: `${os.platform()} ${os.arch()}`, recordFile: path.resolve(args.record) },
      gates: [{ gate: "fault-injection", ok: verdict === "PASS", status: verdict === "PASS" ? "passed" : "failed", detail: { planProblems, results } }],
      verdict,
      honesty: "fv-fault validates plans and execution records; it does not induce faults. The record's truthfulness is the executing runner's responsibility — attach runner logs for FV-3.",
    };
    const out = args.out || path.join(repo, ".formal-verification", "evidence", `fault-${stamp()}.json`);
    lib.writeJson(out, evidence);
    console.log(JSON.stringify({ verdict, out, results: results.map((r) => `${r.case}/${r.fpoint}:${r.ok ? "ok" : "MISSING-OR-FAILED"}`), planProblems }, null, 2));
    process.exit(verdict === "PASS" ? 0 : 1);
  }

  throw new Error(`unknown subcommand ${args.cmd} (plan|check)`);

  function stamp() { return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", ""); }
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
