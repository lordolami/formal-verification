// fv-trace: trace-conformance checking (MASTER-SPEC method: trace-conformance).
//
// A trace file is a recorded sequence of steps against the real system:
//   { "formatVersion": 1, "target": "...", "steps": [
//       { "name": "create", "request": {...}, "observed": { "status": 201, "bodyIncludes": "ok" } } ] }
// Each step carries the OBSERVED outcome recorded during a live run (by your
// driver/test harness) plus an expectation derived from the model. fv-trace
// replays the expectations against the recorded observations — deterministic,
// offline, no live target needed — and reports divergence per step. It cannot
// invent observations: a step without `observed` is an error, never a pass.
//
// Optionally re-executes live with --base (same HTTP mechanics as fv-probe),
// in which case observations are made fresh. Live mode with mutating steps
// requires --allow-mutating.
//
// Evidence gates: [trace-conformance]. Verdict PASS only if every step's
// observation satisfies its expectation. Exit 0/1/2 as usual.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--trace") a.trace = next();
    else if (t === "--base") a.base = next();
    else if (t === "--repo") a.repo = next();
    else if (t === "--out") a.out = next();
    else if (t === "--allow-mutating") a.allowMutating = true;
    else if (t === "--claim") a.claim = next();
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!a.trace) throw new Error("missing --trace <file.json>");
  return a;
}

function expand(template, vars) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function checkExpectation(step, observed) {
  const exp = step.expect || {};
  const problems = [];
  if (exp.status !== undefined && observed.status !== exp.status) problems.push(`status: expected ${exp.status}, observed ${observed.status}`);
  if (Array.isArray(exp.statusIn) && !exp.statusIn.includes(observed.status)) problems.push(`status: expected one of ${exp.statusIn.join("/")}, observed ${observed.status}`);
  if (exp.deny === true && ![401, 403, 404].includes(observed.status)) problems.push(`expected deny (401/403/404), observed ${observed.status}`);
  if (exp.allow === true && !(observed.status >= 200 && observed.status < 300)) problems.push(`expected allow (2xx), observed ${observed.status}`);
  const body = observed.body || "";
  if (exp.bodyIncludes && !body.includes(exp.bodyIncludes)) problems.push(`body missing "${exp.bodyIncludes}"`);
  if (exp.bodyExcludes && body.includes(exp.bodyExcludes)) problems.push(`body must exclude "${exp.bodyExcludes}"`);
  if (exp.stateEquals && JSON.stringify(exp.stateEquals) !== JSON.stringify(observed.state)) problems.push("state mismatch vs model expectation");
  return problems;
}

async function liveStep(base, step, vars, timeoutMs) {
  const req = step.request || {};
  const method = (req.method || "GET").toUpperCase();
  const url = new URL(expand(req.url || "/", vars), base);
  const headers = { "x-fv-trace": "formal-verification" };
  if (req.tokenEnv && process.env[req.tokenEnv]) headers.authorization = `Bearer ${process.env[req.tokenEnv]}`;
  let body;
  if (req.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(req.json); }
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 4000) };
}

async function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const startedAt = lib.nowIso();
  const traceFile = path.resolve(args.trace);
  const doc = JSON.parse(fs.readFileSync(traceFile, "utf8"));
  if (!Array.isArray(doc.steps) || doc.steps.length === 0) throw new Error("trace has no steps; refusing vacuous conformance");

  const vars = { ...(doc.vars || {}) };
  const live = !!args.base;
  const results = [];
  for (const step of doc.steps) {
    const name = step.name || "(unnamed)";
    try {
      let observed = step.observed || null;
      if (live) {
        const method = ((step.request || {}).method || "GET").toUpperCase();
        if (method !== "GET" && !args.allowMutating) {
          results.push({ step: name, ok: false, detail: "live mutating step requires --allow-mutating" });
          continue;
        }
        observed = await liveStep(args.base, step, vars, 15000);
      }
      if (!observed || typeof observed.status !== "number") {
        results.push({ step: name, ok: false, detail: "step has no recorded observation and no live base given — conformance cannot be judged" });
        continue;
      }
      const problems = checkExpectation(step, observed);
      results.push({ step: name, ok: problems.length === 0, claim: step.claim || args.claim || null, detail: problems.join("; ") || `observed ${observed.status} as expected`, observedStatus: observed.status });
    } catch (e) {
      results.push({ step: name, ok: false, detail: `step error: ${e.message}` });
    }
  }

  const failed = results.filter((r) => !r.ok);
  const verdict = failed.length ? "FAIL" : "PASS";
  const record = {
    tool: "formal-verification/fv-trace",
    formatVersion: 2,
    target: live ? new URL(args.base).origin : doc.target || "recorded-trace",
    traceFile,
    traceSha256: lib.sha256File(traceFile),
    startedAt, finishedAt: lib.nowIso(),
    quintExpected: null, quintActual: null, setupError: null,
    provenance: { gitCommit: lib.gitCommit(repo), node: process.version, platform: `${os.platform()} ${os.arch()}`, mode: live ? "live" : "recorded" },
    gates: [{ gate: "trace-conformance", ok: verdict === "PASS", status: verdict === "PASS" ? "passed" : "failed", detail: results }],
    verdict,
    honesty: live
      ? "Steps were executed live just now; verdict binds this target at the recorded time."
      : "Offline replay of recorded observations. Verdict binds the recording, not the live system; re-run live for FV-3 evidence.",
  };
  const out = args.out || path.join(repo, ".formal-verification", "evidence", `trace-${stamp()}.json`);
  lib.writeJson(out, record);
  console.log(JSON.stringify({ verdict, out, steps: results.map((r) => `${r.step}:${r.ok ? "ok" : "DIVERGED"}`) }, null, 2));
  process.exit(verdict === "PASS" ? 0 : 1);

  function stamp() { return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", ""); }
}

main().catch((e) => { console.error(`formal-verification error: ${e.message}`); process.exit(2); });
