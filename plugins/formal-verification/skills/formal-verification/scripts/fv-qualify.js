// fv-qualify: the harness qualifies ITSELF (MASTER-SPEC Stage 13).
//
// The harness may not claim detection capability it has not demonstrated.
// This battery runs seeded cases with known expectations:
//
//   Q1  verdict honesty — gateVerdict/aggregateVerdict unit cases (in-process)
//   Q2  model corpus    — every starter model + the todo example through
//                         fv-run, with environment-aware expected verdicts
//   Q3  mutant corpus   — fv-mutate on tooth-bearing models must PASS
//                         (every applicable mutant killed)
//   Q4  probe detection — fv-probe against the two-faced demo server:
//                         secure mode must PASS, insecure mode must FAIL
//                         (BOLA + mass-assignment detected)
//
// Expectations are environment-aware: without Java 21+, model checks expect
// PASS-WITHOUT-EXHAUSTIVE and the report says so. A case that cannot execute
// (e.g. quint install needs network) is recorded as failed/error — never as
// a pass.
// Usage: node fv-qualify.js [--repo <dir>] [--skill <dir>] [--out <report.json>]
// Exit: 0 battery green, 1 any case failed/errored, 2 setup error.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;
const { spawn, spawnSync } = require("node:child_process");

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--repo") a.repo = next();
    else if (t === "--skill") a.skill = next();
    else if (t === "--out") a.out = next();
    else if (t === "--skip-verify") a.skipVerify = true;
    else throw new Error(`unknown argument: ${t}`);
  }
  return a;
}

function runNode(script, scriptArgs, timeoutSeconds) {
  const r = spawnSync(process.execPath, [script, ...scriptArgs], {
    encoding: "utf8",
    timeout: (timeoutSeconds || 900) * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function readVerdict(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")).verdict; } catch { return null; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(srv, timeoutMs) {
  const started = Date.now();
  let buf = "";
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("demo server start timeout")), timeoutMs);
    srv.stdout.on("data", (d) => {
      buf += String(d);
      if (buf.includes('"port"')) { clearTimeout(to); resolve(); }
    });
    srv.on("error", (e) => { clearTimeout(to); reject(e); });
    srv.on("exit", (code) => { clearTimeout(to); reject(new Error(`demo server exited early (${code}): ${buf}`)); });
    void started;
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const skill = args.skill ? path.resolve(args.skill) : path.resolve(__dirname, "..");
  const repoRoot = path.resolve(skill, "..", "..", "..", ".."); // formal-verification repo root
  const repo = args.repo ? path.resolve(args.repo) : repoRoot;
  const cfg = lib.loadConfig(skill);
  const scripts = path.join(skill, "scripts");
  const startedAt = lib.nowIso();

  const java = lib.detectJava();
  const javaOk = java.found && java.major !== null && java.major >= 21;
  // Resource gate (MASTER-SPEC §10): exhaustive verify is opt-in. --skip-verify
  // runs fv-run with verification skipped so the battery exercises the same
  // code paths without saturating the machine; expectations follow the mode.
  const modelVerdictExpectation = (javaOk && !args.skipVerify) ? "PASS" : "PASS-WITHOUT-EXHAUSTIVE";
  const accepts = (v) => v === modelVerdictExpectation || (modelVerdictExpectation === "PASS-WITHOUT-EXHAUSTIVE" && v === "PASS");

  const cases = [];
  const rec = (id, expectation, observed, ok, detail) =>
    cases.push({ id, expectation, observed, ok, detail: String(detail || "").slice(-1500) });

  // ---------------- Q1: verdict honesty unit battery ----------------
  const unit = [
    ["empty", [], "FAIL"],
    ["verify-skipped-caps", [{ gate: "verify", ok: true, status: "skipped-no-java21" }], "PASS-WITHOUT-EXHAUSTIVE"],
    ["all-passed", [{ gate: "parse", ok: true, status: "passed" }, { gate: "verify", ok: true, status: "passed" }], "PASS"],
    ["one-failed", [{ gate: "parse", ok: false, status: "failed" }], "FAIL"],
    ["legacy-no-status", [{ gate: "parse", ok: true, detail: {} }], "FAIL"],
    ["unknown-status", [{ gate: "parse", ok: true, status: "whatever" }], "FAIL"],
    ["sim-skipped-caps", [{ gate: "simulate", ok: true, status: "skipped-by-flag" }, { gate: "verify", ok: true, status: "passed" }], "PASS-WITHOUT-EXHAUSTIVE"],
  ];
  let unitOk = true;
  const unitDetail = [];
  for (const [name, gates, want] of unit) {
    const got = lib.gateVerdict(gates);
    if (got !== want) { unitOk = false; unitDetail.push(`${name}: want ${want}, got ${got}`); }
  }
  if (lib.aggregateVerdict(["PASS", "PASS-WITHOUT-EXHAUSTIVE"]) !== "PASS-WITHOUT-EXHAUSTIVE") { unitOk = false; unitDetail.push("aggregate mixed"); }
  if (lib.aggregateVerdict([]) !== "FAIL") { unitOk = false; unitDetail.push("aggregate empty"); }
  if (lib.aggregateVerdict(["PASS", "PASS"]) !== "PASS") { unitOk = false; unitDetail.push("aggregate all-pass"); }
  rec("Q1.verdict-honesty", "all unit cases match", unitOk ? "match" : "mismatch", unitOk,
    unitDetail.join("; ") || `gateVerdict/aggregateVerdict exercised on ${unit.length + 3} cases`);

  // ---------------- Q2: model corpus through fv-run ----------------
  const invariantsByModel = {
    token_lifecycle: ["noBadGrant"],
    crud_api: ["errorsCarryNoPartialState", "idempotentReplaySafe"],
    kv_store: ["committedSurvivesCrash", "uncommittedInvisibleAfterCrash"],
    leader_election: ["atMostOneLeaderPerTerm"],
    lease_lock: ["mutualExclusion"],
    file_publish: ["finalizeRequiresStage", "deletedNeverFinalized"],
    sync_session: ["cursorNeverAhead", "appliedNeverAhead"],
    backup_restore: ["servingIsLive", "publishIsHonest"],
    tenant_isolation: ["isolationHolds"],
    privileged_boundary: ["boundaryHolds"],
    idempotent_job: ["effectsAtMostOnce", "noEffectWithoutCommit"],
  };
  const evidenceDir = path.join(repo, ".formal-verification", "evidence");
  lib.ensureDir(evidenceDir);

  const modelsDir = path.join(skill, "assets", "models");
  const modelFiles = fs.readdirSync(modelsDir).filter((f) => f.endsWith(".qnt")).sort();
  for (const f of modelFiles) {
    const name = path.basename(f, ".qnt");
    const outEv = path.join(evidenceDir, `qualify-${name}.json`);
    const runArgs = ["--model", path.join(modelsDir, f), "--repo", repo, "--seed", "1", "--out", outEv, ...(args.skipVerify ? ["--skip-verify"] : [])];
    for (const i of invariantsByModel[name] || []) runArgs.push("--invariants", i);
    const r = runNode(path.join(scripts, "fv-run.js"), runArgs, 900);
    const verdict = readVerdict(outEv);
    rec(`Q2.model.${name}`, modelVerdictExpectation, verdict || `exit ${r.status}`, accepts(verdict),
      accepts(verdict) ? "" : `${r.stdout}\n${r.stderr}`.slice(-1200));
  }

  const todoModel = path.join(repoRoot, "examples", "todo-api", "todos_crud.qnt");
  if (fs.existsSync(todoModel)) {
    const outEv = path.join(evidenceDir, "qualify-todos_crud.json");
    const r = runNode(path.join(scripts, "fv-run.js"),
      ["--model", todoModel, "--repo", repo, "--seed", "1", "--invariants", "ownerIsolation", "--invariants", "errorsCarryNoPartialState", "--out", outEv, ...(args.skipVerify ? ["--skip-verify"] : [])], 900);
    const verdict = readVerdict(outEv);
    rec("Q2.model.todos_crud(example)", modelVerdictExpectation, verdict || `exit ${r.status}`, accepts(verdict),
      accepts(verdict) ? "" : `${r.stdout}\n${r.stderr}`.slice(-1200));
  }

  // ---------------- Q3: mutant corpus must be killed ----------------
  const mutateTargets = ["token_lifecycle", "crud_api", "kv_store", "leader_election", "lease_lock", "file_publish", "sync_session", "backup_restore", "tenant_isolation", "privileged_boundary"];
  for (const name of mutateTargets) {
    const outEv = path.join(evidenceDir, `qualify-mutate-${name}.json`);
    const mArgs = ["--model", path.join(modelsDir, `${name}.qnt`), "--repo", repo, "--seed", "1", "--out", outEv];
    for (const i of invariantsByModel[name] || []) mArgs.push("--invariants", i);
    const r = runNode(path.join(scripts, "fv-mutate.js"), mArgs, 1200);
    const verdict = readVerdict(outEv);
    rec(`Q3.mutants.${name}`, "PASS (all applicable mutants killed)", verdict || `exit ${r.status}`, verdict === "PASS",
      verdict === "PASS" ? "" : `${r.stdout}\n${r.stderr}`.slice(-1200));
  }

  // ---------------- Q4: probe detection on the two-faced demo ----------------
  const demoServer = path.join(repoRoot, "examples", "probe-demo", "server.js");
  const probeSet = path.join(skill, "assets", "probes", "backend-security-probes.json");
  for (const mode of ["secure", "insecure"]) {
    const port = mode === "secure" ? 18101 : 18102;
    const srv = spawn(process.execPath, [demoServer], {
      env: { ...process.env, FV_DEMO_MODE: mode, FV_DEMO_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitForServer(srv, 15000);
      await sleep(100);
      const outEv = path.join(evidenceDir, `qualify-probe-${mode}.json`);
      const r = spawnSync(process.execPath, [path.join(scripts, "fv-probe.js"),
        "--probes", probeSet, "--base", `http://127.0.0.1:${port}`, "--allow-mutating", "--pin-host", "127.0.0.1",
        "--repo", repo, "--out", outEv], {
        encoding: "utf8", timeout: 120000,
        env: {
          ...process.env,
          FV_PROBE_ALICE_TOKEN: "aliceTok",
          FV_PROBE_BOB_TOKEN: "bobTok",
          FV_PROBE_ALICE_OBJECT_ID: "recAlice000000001",
          FV_PROBE_BOB_OBJECT_ID: "recBob00000000001",
        },
      });
      const verdict = readVerdict(outEv);
      const want = mode === "secure" ? "PASS" : "FAIL";
      rec(`Q4.probe.${mode}`, want, verdict || `exit ${r.status}`, verdict === want,
        verdict === want ? "" : `${r.stdout || ""}\n${r.stderr || ""}`.slice(-1200));
    } catch (e) {
      rec(`Q4.probe.${mode}`, mode === "secure" ? "PASS" : "FAIL", "error", false, e.message);
    } finally {
      try { srv.kill(); } catch { /* already gone */ }
    }
  }

  // ---------------- Q5: claim-graph engine + assurance export ----------------
  {
    const tmpRepo = path.join(repo, ".formal-verification", "qualify-claims-demo");
    const run = (script, a2) => {
      const r = spawnSync(process.execPath, [path.join(scripts, script), ...a2], { encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
      return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
    };
    try {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
      lib.ensureDir(tmpRepo);
      const init = run("fv-claims.js", ["init", "--repo", tmpRepo, "--system", "qualify-demo"]);
      rec("Q5.claims.init", "exit 0", "exit " + init.status, init.status === 0, init.stderr.slice(-400));
      const add1 = run("fv-claims.js", ["add", "--repo", tmpRepo, "--claim", "CLM-AUTHZ-002"]);
      const add2 = run("fv-claims.js", ["add", "--repo", tmpRepo, "--claim", "CLM-ISO-001"]);
      rec("Q5.claims.adopt-catalog", "exit 0 x2", "exit " + add1.status + "/" + add2.status, add1.status === 0 && add2.status === 0, (add1.stderr + add2.stderr).slice(-400));
      const st0 = run("fv-claims.js", ["status", "--repo", tmpRepo, "--format", "json"]);
      let unsupportedOk = false;
      try { const j = JSON.parse(st0.stdout); unsupportedOk = j.claimsDetail.every((c) => c.status === "UNSUPPORTED" && c.assuranceLevel === "FV-0"); } catch {}
      rec("Q5.claims.born-unsupported", "all UNSUPPORTED/FV-0", unsupportedOk ? "as expected" : st0.stdout.slice(-300), unsupportedOk, "");
      const evFile = path.join(evidenceDir, "qualify-token_lifecycle.json");
      const link = run("fv-claims.js", ["link", "--repo", tmpRepo, "--claim", "CLM-AUTHZ-002", "--evidence", evFile, "--method", "model-adversarial"]);
      const st1 = run("fv-claims.js", ["status", "--repo", tmpRepo, "--format", "json"]);
      let lvl = null;
      try { const j = JSON.parse(st1.stdout); lvl = j.claimsDetail.find((c) => c.id === "CLM-AUTHZ-002"); } catch {}
      rec("Q5.claims.link-raises-level", "FV-1 + SUPPORTED", lvl ? lvl.assuranceLevel + "/" + lvl.status : "unparseable", !!(lvl && lvl.assuranceLevel === "FV-1" && lvl.status === "SUPPORTED"), (link.stderr || "").slice(-300));
      const asr = run("fv-assurance.js", ["--repo", tmpRepo]);
      const mdPath = path.join(tmpRepo, ".formal-verification", "assurance", "assurance-case.md");
      let mdOk = false;
      if (fs.existsSync(mdPath)) { const md = fs.readFileSync(mdPath, "utf8"); mdOk = /Residuals/.test(md) && !/\bcertified\b/i.test(md); }
      rec("Q5.assurance.export", "case md+json, residuals section, no banned words", mdOk ? "as expected" : "exit " + asr.status, asr.status === 0 && mdOk, (asr.stderr || "").slice(-400));
      const stale = run("fv-stale.js", ["--repo", tmpRepo]);
      rec("Q5.stale.clean", "exit 0", "exit " + stale.status, stale.status === 0, (stale.stdout || stale.stderr).slice(-300));
    } catch (e) {
      rec("Q5.claims.block", "executes", "error", false, e.message);
    }
  }

  // ---------------- Q6: new-method tools on fixtures ----------------
  {
    const run = (script, a2) => {
      const r = spawnSync(process.execPath, [path.join(scripts, script), ...a2], { encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
      return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
    };
    const tr = run("fv-trace.js", ["--trace", path.join(repoRoot, "examples", "trace-demo", "trace.json"), "--repo", repo]);
    rec("Q6.trace.recorded-conforms", "PASS", "exit " + tr.status, tr.status === 0, (tr.stdout + tr.stderr).slice(-400));
    const fp = run("fv-fault.js", ["plan", "--plan", path.join(repoRoot, "examples", "fault-demo", "fault-plan.json"), "--repo", repo]);
    const fc = run("fv-fault.js", ["check", "--plan", path.join(repoRoot, "examples", "fault-demo", "fault-plan.json"), "--record", path.join(repoRoot, "examples", "fault-demo", "execution-record.json"), "--repo", repo]);
    rec("Q6.fault.plan+check", "exit 0 x2", "exit " + fp.status + "/" + fc.status, fp.status === 0 && fc.status === 0, (fp.stdout + fc.stdout).slice(-400));
    const disc = run("fv-discover.js", ["--repo", repo, "--routes", path.join(repoRoot, "examples")]);
    let discOk = false;
    try { discOk = JSON.parse(disc.stdout).summary.routeFiles >= 1; } catch {}
    rec("Q6.discover.routes-scan", "inventory written", discOk ? "as expected" : "exit " + disc.status, disc.status === 0 && discOk, (disc.stdout + disc.stderr).slice(-400));
    const cov = run("fv-cover.js", ["--model", path.join(skill, "assets", "models", "token_lifecycle.qnt"), "--evidence", path.join(evidenceDir, "qualify-token_lifecycle.json"), "--repo", repo]);
    let covOk = false;
    try { const j = JSON.parse(cov.stdout); covOk = j.models[0].invariants >= 1; } catch {}
    rec("Q6.cover.model", "coverage measured", covOk ? "as expected" : "exit " + cov.status, cov.status === 0 && covOk, (cov.stdout + cov.stderr).slice(-400));
    const sarifFile = path.join(repo, ".formal-verification", "qualify-fixtures.sarif.json");
    lib.writeJson(sarifFile, { version: "2.1.0", runs: [{ tool: { driver: { name: "QualifyScanner", rules: [{ id: "bola-check", name: "Broken Object Level Authorization" }] } }, results: [{ ruleId: "bola-check", level: "error", message: { text: "handler returns object without owner check" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/items.go" }, region: { startLine: 42 } } }] }] }] });
    const sc = run("fv-scan.js", ["--repo", repo, "--sarif", sarifFile]);
    const fusionFile = path.join(repo, ".formal-verification", "scans", "fusion.json");
    let scanOk = false;
    try { const j = JSON.parse(fs.readFileSync(fusionFile, "utf8")); scanOk = j.hypotheses.length === 1 && j.hypotheses[0].status === "HYPOTHESIS" && j.hypotheses[0].candidateClaims.includes("CLM-AUTHZ-004"); } catch {}
    rec("Q6.scan.hypothesis-not-finding", "1 HYPOTHESIS mapped to CLM-AUTHZ-004", scanOk ? "as expected" : "exit " + sc.status, sc.status === 0 && scanOk, (sc.stdout + sc.stderr).slice(-400));
  }

  // ---------------- summary ----------------
  const failed = cases.filter((c) => !c.ok);
  const verdict = failed.length === 0 ? "PASS" : "FAIL";
  const report = {
    tool: "formal-verification/fv-qualify",
    formatVersion: 2,
    harnessVersion: cfg.harnessVersion,
    startedAt,
    finishedAt: lib.nowIso(),
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      java: java.versionLine,
      javaOkForVerify: javaOk,
      modelVerdictExpectation,
      note: args.skipVerify
        ? "Exhaustive verify SKIPPED by --skip-verify (resource gate, MASTER-SPEC §10): model checks expected at PASS-WITHOUT-EXHAUSTIVE. The battery qualifies detection behavior, not exhaustive proof, in this mode."
        : javaOk
          ? "Java 21+ present: model checks were expected to reach exhaustive PASS."
          : "Java <21 (or absent): exhaustive verify could not run, so model checks were expected at PASS-WITHOUT-EXHAUSTIVE. This battery therefore qualifies detection behavior, not exhaustive proof, on this machine.",
    },
    cases,
    summary: { total: cases.length, passed: cases.length - failed.length, failed: failed.length },
    verdict,
    honesty: "This battery qualifies the harness against seeded cases. It does not certify the harness, and it must be re-run on every harness or engine change.",
  };
  const out = args.out || path.join(repo, ".formal-verification", "evidence", `qualify-${stamp()}.json`);
  lib.writeJson(out, report);
  console.log(JSON.stringify({
    verdict, out,
    environment: report.environment,
    summary: report.summary,
    failed: failed.map((f) => f.id),
  }, null, 2));
  process.exit(verdict === "PASS" ? 0 : 1);

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  }
}

main().catch((e) => {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
});
