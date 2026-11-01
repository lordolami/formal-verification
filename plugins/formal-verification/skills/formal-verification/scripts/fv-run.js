// fv-run: execute the formal-verification pipeline for one Quint model.
// Usage:
//   node fv-run.js --model <path.qnt> --main <module> [--repo <dir>] [--skill <dir>]
//                  [--invariants a --invariants b] [--temporal t]
//                  [--simulate|--skip-simulate] [--test|--skip-test] [--verify|--skip-verify]
//                  [--max-samples N] [--max-steps N] [--seed S] [--out <evidence.json>]
//
// Pipeline: ensure quint -> parse -> typecheck -> run (simulate) -> test -> verify.
// Evidence format v2 (see MASTER-SPEC.md): provenance (model SHA-256, git commit,
// engine versions, environment, seed, budgets) + per-gate { gate, ok, status, detail }.
//
// HONESTY CONTRACT (v0.2.0): verdict is PASS only when every gate ran and passed,
// verify included. Skipped verify (by flag OR by missing Java 21+) caps the
// verdict at PASS-WITHOUT-EXHAUSTIVE. Skipped simulate/test likewise cap it.
// Exit code 0 only on PASS. Exit 3 on PASS-WITHOUT-EXHAUSTIVE. Exit 1 on FAIL.
// Setup errors exit 2. Never claim "fully correct" on simulation alone.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

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
  const seed = args.seed !== undefined ? String(args.seed) : "1";

  // ---- provenance (collected before any gate runs; part of the evidence) ----
  let modelSha256 = null;
  try { modelSha256 = lib.sha256File(modelAbs); } catch { /* recorded as null */ }
  const provenance = {
    formatVersion: 2,
    model: modelAbs,
    modelSha256,
    main: args.main || null,
    invariants: args.invariants,
    temporals: args.temporals,
    seed,
    budgets: {
      simulateMaxSamples: args.maxSamples || budgets.simulation.maxSamples,
      simulateMaxSteps: args.maxSteps || budgets.simulation.maxSteps,
      verifyMaxSteps: budgets.verify.maxSteps,
    },
    gitCommit: lib.gitCommit(repo),
    gitDirty: lib.gitDirty(repo),
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
  };

  let bin;
  let quintActual = "not-installed";
  try {
    const inst = lib.ensureQuintInstalled(repo, cfg);
    bin = inst.bin;
    quintActual = lib.quintVersion(bin);
  } catch (e) {
    return finish(provenance, gates, e.message, { quint: cfg.quintVersion, quintActual });
  }
  provenance.quintVersion = quintActual;

  const invFlags = [];
  for (const inv of args.invariants) invFlags.push("--invariants", inv);
  const maxSamples = String(args.maxSamples || budgets.simulation.maxSamples);
  const maxStepsSim = String(args.maxSteps || budgets.simulation.maxSteps);
  const seedArgs = ["--seed", seed];

  // ---- gate 1: parse ----
  const p = lib.runQuintStage(bin, ["parse", modelAbs], { timeoutSeconds: 120 });
  gates.push({ gate: "parse", ok: p.status === 0, status: p.status === 0 ? "passed" : "failed", detail: tail(p) });
  if (p.status !== 0) return finish(provenance, gates, null, { quint: cfg.quintVersion, quintActual });

  // ---- gate 2: typecheck ----
  const tcArgs = ["typecheck", modelAbs];
  if (args.main) tcArgs.push("--main", args.main);
  const tc = lib.runQuintStage(bin, tcArgs, { timeoutSeconds: 180 });
  gates.push({ gate: "typecheck", ok: tc.status === 0, status: tc.status === 0 ? "passed" : "failed", detail: tail(tc) });
  if (tc.status !== 0) return finish(provenance, gates, null, { quint: cfg.quintVersion, quintActual });

  // ---- gate 3: simulate ----
  if (args.simulate) {
    const runArgs = ["run", modelAbs, "--max-samples", maxSamples, "--max-steps", maxStepsSim, ...seedArgs];
    if (args.main) runArgs.push("--main", args.main);
    runArgs.push(...invFlags);
    const s = lib.runQuintStage(bin, runArgs, { timeoutSeconds: budgets.simulation.timeoutSeconds });
    const ok = s.status === 0 && /\[ok\] No violation found/.test(`${s.stdout}\n${s.stderr}`);
    gates.push({ gate: "simulate", ok, status: ok ? "passed" : "failed", detail: tail(s) });
    if (!ok) return finish(provenance, gates, null, { quint: cfg.quintVersion, quintActual });
  } else {
    gates.push({ gate: "simulate", ok: true, status: "skipped-by-flag", detail: "simulation skipped by --skip-simulate; verdict capped at PASS-WITHOUT-EXHAUSTIVE" });
  }

  // ---- gate 4: test (each `run` case by anchored name; zero tests is FAIL) ----
  if (args.test) {
    const names = listRunTests(modelAbs);
    if (!names.length) {
      gates.push({ gate: "test", ok: false, status: "failed", detail: "no `run` tests found in model; refusing vacuous pass" });
      return finish(provenance, gates, null, { quint: cfg.quintVersion, quintActual });
    }
    let allOk = true;
    const perTest = [];
    for (const nm of names) {
      const tArgs = ["test", modelAbs, "--match", `^${nm}$`, ...seedArgs];
      if (args.main) tArgs.push("--main", args.main);
      const t = lib.runQuintStage(bin, tArgs, { timeoutSeconds: budgets.test.timeoutSeconds });
      const body = `${t.stdout}\n${t.stderr}`;
      const ok = t.status === 0 && /passing/.test(body) && !/failing|failed/.test(body.replace(/0 failing/g, ""));
      perTest.push({ test: nm, ok, detail: tail(t) });
      if (!ok) allOk = false;
    }
    gates.push({ gate: "test", ok: allOk, status: allOk ? "passed" : "failed", detail: perTest });
    if (!allOk) return finish(provenance, gates, null, { quint: cfg.quintVersion, quintActual });
  } else {
    gates.push({ gate: "test", ok: true, status: "skipped-by-flag", detail: "scenario tests skipped by --skip-test; verdict capped at PASS-WITHOUT-EXHAUSTIVE" });
  }

  // ---- gate 5: verify (exhaustive; needs Java 21+) ----
  if (!args.verify) {
    gates.push({ gate: "verify", ok: true, status: "skipped-by-flag", detail: "exhaustive verification skipped by --skip-verify; correctness is tested, not proven" });
  } else if (args.invariants.length === 0 && args.temporals.length === 0) {
    gates.push({ gate: "verify", ok: false, status: "failed", detail: "no invariants or temporal properties supplied; refusing vacuous verify" });
  } else {
    const java = lib.detectJava();
    provenance.java = java.versionLine;
    const needMajor = Number(String(cfg.javaForVerify || ">=21").replace(/[^0-9]/g, "")) || 21;
    if (!java.found || java.major === null || java.major < needMajor) {
      gates.push({
        gate: "verify", ok: true, status: "skipped-no-java21",
        detail: `exhaustive verification requires Java >= ${needMajor} (Apalache); detected: ${java.versionLine || "none"}. Correctness is tested, not proven.`,
      });
    } else {
      const vArgs = ["verify", modelAbs, "--max-steps", String(budgets.verify.maxSteps)];
      if (args.main) vArgs.push("--main", args.main);
      if (args.invariants.length) vArgs.push("--invariant", args.invariants.join(","));
      if (args.temporals.length) vArgs.push("--temporal", args.temporals.join(","));
      const v = lib.runQuintStage(bin, vArgs, { timeoutSeconds: budgets.verify.timeoutSeconds });
      const ok = v.status === 0;
      gates.push({ gate: "verify", ok, status: ok ? "passed" : "failed", detail: tail(v) });
    }
  }

  return finish(provenance, gates, null, { quint: cfg.quintVersion, quintActual });

  function finish(prov, gateList, setupError, quintInfo) {
    const verdict = setupError ? "FAIL" : lib.gateVerdict(gateList);
    const record = {
      tool: "formal-verification/fv-run",
      formatVersion: 2,
      model: prov.model,
      main: prov.main,
      startedAt,
      finishedAt: lib.nowIso(),
      quintExpected: quintInfo.quint,
      quintActual: quintInfo.quintActual,
      setupError,
      provenance: prov,
      gates: gateList,
      verdict,
    };
    const out = args.out || path.join(repo, ".formal-verification", "evidence", `${stamp()}.json`);
    lib.writeJson(out, record);
    console.log(JSON.stringify({
      verdict, out,
      gates: gateList.map((g) => `${g.gate}:${g.status}`),
      honesty: verdict === "PASS"
        ? "all gates including exhaustive verify passed within recorded bounds"
        : verdict === "PASS-WITHOUT-EXHAUSTIVE"
          ? "tested, not proven: exhaustive verification did not run (see verify gate detail)"
          : "a gate failed or was vacuous; see gate details",
    }, null, 2));
    process.exit(verdict === "PASS" ? 0 : verdict === "PASS-WITHOUT-EXHAUSTIVE" ? 3 : setupError ? 2 : 1);
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
