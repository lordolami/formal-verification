// fv-cover: coverage measurement (MASTER-SPEC Stage 12).
//
// Verdicts without coverage are advertising. fv-cover measures, per model:
//   actions   — every `action NAME` in the file, and how many are exercised
//               by the scenario tests (`.then(NAME(` references in run blocks)
//               and offered in `step`
//   invariants— every `val` invariant; which were passed to fv-run evidence
//   adversaries — adversary actions present (useAfterRevoke, cross*, attempt*
//               heuristics + explicit `--adversary` names) vs exercised
// and, per claim (with --repo claim graph): does the claim have a model,
// probes, mutation evidence — the coverage legs of its assurance level.
//
// Coverage is reported as numbers with gaps named. fv-cover never issues a
// correctness verdict; its evidence verdict is PASS when measurement itself
// succeeded. Low coverage is surfaced in `gaps` for humans/CI policy.
//
// Usage:
//   node fv-cover.js --model <m.qnt> [--evidence <fv-run.json>] [--repo <dir>] [--out <f>]
//   node fv-cover.js --repo <dir> [--claims] [--out <f>]
// Exit: 0 measured, 2 usage/setup. (Policy gates belong in CI config, not here.)

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--model") a.model = next();
    else if (t === "--evidence") a.evidence = next();
    else if (t === "--repo") a.repo = next();
    else if (t === "--claims") a.claims = true;
    else if (t === "--out") a.out = next();
    else throw new Error(`unknown argument: ${t}`);
  }
  return a;
}

function analyzeModel(modelPath) {
  const src = fs.readFileSync(modelPath, "utf8");
  const actions = [...src.matchAll(/(^|\n)\s*action\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[2]);
  const structural = new Set(["init", "step"]);
  const invariants = [...src.matchAll(/(^|\n)\s*val\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[2]);
  const temporals = [...src.matchAll(/(^|\n)\s*temporal\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[2]);
  const runs = [...src.matchAll(/(^|\n)\s*run\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map((m) => m[2]);

  // Exercise = referenced by a run block via .then(name( or .then(name)
  const exercised = new Set();
  for (const m of src.matchAll(/\.then\(\s*([A-Za-z_][A-Za-z0-9_]*)/g)) exercised.add(m[1]);
  // Offered in step: names appearing after `action step` block (approx: whole-file any{...} region near step)
  const stepMatch = src.match(/action\s+step\s*=\s*\{([\s\S]*?)\n\s*\}/);
  const offered = new Set();
  if (stepMatch) for (const m of stepMatch[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) offered.add(m[1]);

  const behaviorActions = actions.filter((x) => !structural.has(x));
  const adversaryRe = /^(use(after|expired|unknown)|cross|attempt|forge|escalate|replay|poison|resumeStale)/i;
  const adversaries = behaviorActions.filter((x) => adversaryRe.test(x));

  return {
    model: modelPath,
    actions: {
      total: behaviorActions.length,
      exercisedByTests: behaviorActions.filter((x) => exercised.has(x)),
      offeredInStep: behaviorActions.filter((x) => offered.has(x)),
      unexercised: behaviorActions.filter((x) => !exercised.has(x)),
      percentExercised: behaviorActions.length ? Math.round(1000 * behaviorActions.filter((x) => exercised.has(x)).length / behaviorActions.length) / 10 : 100,
    },
    invariants: { total: invariants.length, names: invariants },
    temporals: { total: temporals.length, names: temporals },
    runTests: runs,
    adversaries: {
      total: adversaries.length,
      names: adversaries,
      exercised: adversaries.filter((x) => exercised.has(x)),
      note: adversaries.length === 0 ? "no adversary-shaped actions detected (heuristic) — authorization claims need them" : null,
    },
  };
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const startedAt = lib.nowIso();
  const report = {
    tool: "formal-verification/fv-cover",
    formatVersion: 2,
    startedAt, finishedAt: lib.nowIso(),
    repo, gitCommit: lib.gitCommit(repo),
    models: [],
    claims: null,
    gaps: [],
  };

  if (args.model) {
    const a = analyzeModel(path.resolve(args.model));
    if (args.evidence) {
      const ev = JSON.parse(fs.readFileSync(path.resolve(args.evidence), "utf8"));
      const checked = (ev.provenance && ev.provenance.invariants) || [];
      a.invariants.checkedByEvidence = checked;
      a.invariants.unchecked = a.invariants.names.filter((n) => !checked.includes(n));
      if (a.invariants.unchecked.length) report.gaps.push(`${path.basename(args.model)}: invariants never checked: ${a.invariants.unchecked.join(", ")}`);
    }
    if (a.actions.unexercised.length) report.gaps.push(`${path.basename(args.model)}: actions unexercised by scenario tests: ${a.actions.unexercised.join(", ")}`);
    if (a.adversaries.total === 0) report.gaps.push(`${path.basename(args.model)}: no adversary actions detected`);
    report.models.push(a);
  }

  if (args.claims) {
    const gp = path.join(repo, ".formal-verification", "claims", "claims.json");
    if (!fs.existsSync(gp)) throw new Error(`no claim graph at ${gp} (fv-claims init first)`);
    const g = JSON.parse(fs.readFileSync(gp, "utf8"));
    report.claims = g.claims.map((c) => {
      const methods = new Set((c.evidence || []).map((e) => e.method));
      const legs = {
        hasModelRef: !!(c.formalRef && c.formalRef.model),
        hasModelEvidence: [...methods].some((m) => m.startsWith("model-")),
        hasMutation: methods.has("mutation-adequacy"),
        hasImplEvidence: [...methods].some((m) => ["implementation-probes", "trace-conformance", "fault-injection"].includes(m)),
        hasSignoff: (c.signoffs || []).length > 0,
      };
      const missing = Object.entries(legs).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) report.gaps.push(`${c.id}: missing ${missing.join(", ")}`);
      return { id: c.id, class: c.class || "safety", legs, missing };
    });
  }

  if (!args.model && !args.claims) throw new Error("nothing to measure: pass --model and/or --claims");

  const out = args.out || path.join(repo, ".formal-verification", "evidence", `cover-${stamp()}.json`);
  lib.writeJson(out, { ...report, verdictNote: "coverage is measurement, not a correctness verdict" });
  console.log(JSON.stringify({
    out,
    models: report.models.map((m) => ({ model: path.basename(m.model), actionsExercisedPct: m.actions.percentExercised, invariants: m.invariants.total, runTests: m.runTests.length, adversaries: m.adversaries.total })),
    claims: report.claims ? report.claims.length : null,
    gaps: report.gaps,
  }, null, 2));
  process.exit(0);

  function stamp() { return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", ""); }
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
