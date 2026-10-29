// fv-run: execute the formal-verification pipeline for one Quint model.
// Usage:
//   node fv-run.js --model <path.qnt> --main <module> [--repo <dir>] [--skill <dir>]
//                  [--invariants a --invariants b] [--temporal t]
//                  [--simulate|--skip-simulate] [--test|--skip-test] [--verify|--skip-verify]
//                  [--max-samples N] [--max-steps N] [--seed S] [--out <evidence.json>]
// The script runs: ensure quint -> parse -> typecheck -> run -> test -> verify,
// then writes a verdict record. Exit code 0 only when every enabled gate passes.

const lib = require("./lib/fv-lib");
const { fs, path } = lib;

function parseArgs(argv) {
  const a = { invariants: [], temporals: [], simulate: true, test: true, verify: true };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--model") a.model = next();
    else if (t === "--main") a.main = next();
    else if (t === "--repo") a.repo = next();
    else if (t === "--skill") a.skill = next();
    else if (t === "--invariants") a.invariants.push(next());
    else if (t === "--temporal") a.temporals.push(next());
    else if (t === "--max-samples") a.maxSamples = Number(next());
    else if (t === "--max-steps") a.maxSteps = Number(next());
    else if (t === "--seed") a.seed = next();
    else if (t === "--out") a.out = next();
    else if (t === "--simulate") a.simulate = true;
    else if (t === "--skip-simulate") a.simulate = false;
    else if (t === "--test") a.test = true;
    else if (t === "--skip-test") a.test = false;
    else if (t === "--verify") a.verify = true;
    else if (t === "--skip-verify") a.verify = false;
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!a.model) throw new Error("missing --model <path.qnt>");
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const skill = args.skill ? path.resolve(args.skill) : path.resolve(__dirname, "..");
  const cfg = lib.loadConfig(skill);
  const budgets = cfg.defaultProfileBudgets;

  const modelAbs = path.resolve(args.model);
  if (!fs.existsSync(modelAbs)) throw new Error(`model not found: ${modelAbs}`);

  const gates = [];
  const startedAt = lib.nowIso();

  let bin;
  try {
    const inst = lib.ensureQuintInstalled(repo, cfg);
    bin = inst.bin;
  } catch (e) {
    return finish({ quint: cfg.quintVersion, quintActual: "not-installed" }, gates, e.message);
  }
  const qv = lib.quintVersion(bin);

  const invFlags = [];
  for (const inv of args.invariants) invFlags.push("--invariants", inv);
  const maxSamples = String(args.maxSamples || budgets.simulation.maxSamples);
  const maxStepsSim = String(args.maxSteps || budgets.simulation.maxSteps);
  const seedArgs = args.seed ? ["--seed", String(args.seed)] : [];

  const p = lib.runQuintStage(bin, ["parse", modelAbs], { timeoutSeconds: 120 });
  gates.push({ gate: "parse", ok: p.status === 0, detail: tail(p) });
  if (p.status !== 0) return finish({ quint: cfg.quintVersion, quintActual: qv }, gates, null);

  const tcArgs = ["typecheck", modelAbs];
  if (args.main) tcArgs.push("--main", args.main);
  const tc = lib.runQuintStage(bin, tcArgs, { timeoutSeconds: 180 });
  gates.push({ gate: "typecheck", ok: tc.status === 0, detail: tail(tc) });
  if (tc.status !== 0) return finish({ quint: cfg.quintVersion, quintActual: qv }, gates, null);

  if (args.simulate) {
    const runArgs = ["run", modelAbs, "--max-samples", maxSamples, "--max-steps", maxStepsSim, ...seedArgs];
    if (args.main) runArgs.push("--main", args.main);
    runArgs.push(...invFlags);
    const s = lib.runQuintStage(bin, runArgs, { timeoutSeconds: budgets.simulation.timeoutSeconds });
    gates.push({ gate: "simulate", ok: s.status === 0, detail: tail(s) });
  } else {
    gates.push({ gate: "simulate", ok: true, detail: "skipped by flag" });
  }

  if (args.test) {
    // NOTE: `quint test` with no --match discovers zero tests and passes vacuously
    // in some builds. Extract `run NAME = {...}` test names and execute each with
    // an anchored --match so a passing gate means tests actually ran.
    const names = listRunTests(modelAbs);
    if (!names.length) {
      gates.push({ gate: "test", ok: false, detail: "no `run` tests found in model; refusing vacuous pass" });
    } else {
      let allOk = true;
      const perTest = [];
      for (const nm of names) {
        const tArgs = ["test", modelAbs, "--match", `^${nm}$`, ...seedArgs];
        if (args.main) tArgs.push("--main", args.main);
        const t = lib.runQuintStage(bin, tArgs, { timeoutSeconds: budgets.test.timeoutSeconds });
        const ok = t.status === 0 && /passing/.test(`${t.stdout}\n${t.stderr}`) && !/failed/.test(`${t.stdout}\n${t.stderr}`);
        perTest.push({ test: nm, ok, detail: tail(t) });
        if (!ok) allOk = false;
      }
      gates.push({ gate: "test", ok: allOk, detail: perTest });
    }
  } else {
    gates.push({ gate: "test", ok: true, detail: "skipped by flag" });
  }

  if (args.verify) {
    if (args.invariants.length === 0 && args.temporals.length === 0) {
      gates.push({ gate: "verify", ok: false, detail: "no invariants or temporal properties supplied; refusing vacuous pass" });
    } else {
      const vArgs = ["verify", modelAbs, "--max-steps", String(budgets.verify.maxSteps)];
      if (args.main) vArgs.push("--main", args.main);
      if (args.invariants.length) vArgs.push("--invariant", args.invariants.join(","));
      if (args.temporals.length) vArgs.push("--temporal", args.temporals.join(","));
      const v = lib.runQuintStage(bin, vArgs, { timeoutSeconds: budgets.verify.timeoutSeconds });
      gates.push({ gate: "verify", ok: v.status === 0, detail: tail(v) });
    }
  } else {
    gates.push({ gate: "verify", ok: true, detail: "skipped by flag" });
  }

  return finish({ quint: cfg.quintVersion, quintActual: qv }, gates, null);

  function finish(quintInfo, gateList, setupError) {
    const verdict = setupError ? "FAIL" : lib.gateVerdict(gateList);
    const record = {
      tool: "formal-verification/fv-run",
      model: modelAbs,
      main: args.main || null,
      startedAt,
      finishedAt: lib.nowIso(),
      quintExpected: quintInfo.quint,
      quintActual: quintInfo.quintActual,
      setupError,
      gates: gateList,
      verdict,
    };
    const out = args.out || path.join(repo, ".formal-verification", "evidence", `${stamp()}.json`);
    lib.writeJson(out, record);
    console.log(JSON.stringify({ verdict, out, gates: gateList.map((g) => `${g.gate}:${g.ok ? "ok" : "FAIL"}`) }, null, 2));
    process.exit(verdict === "PASS" ? 0 : 1);
  }

  function tail(r) {
    const s = `${r.stdout}\n${r.stderr}`.trim();
    const lines = s.split("\n");
    return { command: r.command, exit: r.status, timedOut: !!r.timedOut, outputTail: lines.slice(-25).join("\n") };
  }

  function stamp() {
    const d = new Date();
    return d.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  }

  function listRunTests(modelPath) {
    const src = fs.readFileSync(modelPath, "utf8");
    const names = [];
    const re = /(^|\n)\s*run\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
    let m;
    while ((m = re.exec(src)) !== null) names.push(m[2]);
    return names;
  }
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
