// Shared helpers for the formal-verification pipeline scripts.
// Node >= 20. No external dependencies.
//
// v0.2.0 honesty contract (see MASTER-SPEC.md sections 2-3, CHANGELOG.md):
//   - Verdicts: PASS | PASS-WITHOUT-EXHAUSTIVE | FAIL. A skipped gate can
//     NEVER contribute to PASS. Skipped exhaustive verification caps the
//     verdict at PASS-WITHOUT-EXHAUSTIVE.
//   - gateVerdict is fail-closed: unknown gate states fail.
//   - Evidence carries provenance: seed, budgets, SHA-256 of the model,
//     git commit of the target repo, engine versions.

const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

// ---------------------------------------------------------------- config

function loadConfig(skillDir) {
  const p = path.join(skillDir, "scripts", "fv.config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// ---------------------------------------------------------------- hashing / provenance

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function sha256String(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function gitCommit(repoRoot) {
  try {
    const r = execSync("git rev-parse HEAD", {
      cwd: repoRoot, encoding: "utf8", timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return String(r).trim() || null;
  } catch {
    return null;
  }
}

function gitDirty(repoRoot) {
  try {
    const r = execSync("git status --porcelain", {
      cwd: repoRoot, encoding: "utf8", timeout: 15000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return String(r).trim().length > 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- java detection

// Returns { found: bool, major: number|null, versionLine: string|null }.
// quint verify (Apalache) requires Java >= 21 (fv.config.json javaForVerify).
function detectJava() {
  const r = spawnSync("java", ["-version"], { encoding: "utf8", timeout: 30000 });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const m = out.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return { found: false, major: null, versionLine: null };
  const major = Number(m[1]);
  const line = out.split("\n").map((s) => s.trim()).find((s) => s.length > 0) || null;
  return { found: true, major, versionLine: line };
}

function javaMajorOfLine(line) {
  if (!line) return null;
  const m = String(line).match(/"(\d+)/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- quint install / run

function quintBin(repoRoot) {
  const local = path.join(repoRoot, ".formal-verification", "quint", "node_modules", ".bin", "quint");
  if (fs.existsSync(local)) return local;
  return "quint";
}

function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function ensureQuintInstalled(repoRoot, cfg) {
  const dir = path.join(repoRoot, ".formal-verification", "quint");
  const bin = path.join(dir, "node_modules", ".bin", process.platform === "win32" ? "quint.cmd" : "quint");
  if (fs.existsSync(bin)) return { bin, installed: true, fresh: false };
  fs.mkdirSync(dir, { recursive: true });
  const spec = `${cfg.quintNpm}@${cfg.quintVersion}`;
  const r = spawnSync(npmCmd(), ["install", "--no-audit", "--no-fund", "--prefix", dir, spec], {
    encoding: "utf8",
    timeout: 1000 * 60 * 10,
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    throw new Error(`quint install failed (${spec}):\n${r.stderr || r.stdout || (r.error && r.error.message)}`);
  }
  return { bin: path.join(dir, "node_modules", ".bin", process.platform === "win32" ? "quint.cmd" : "quint"), installed: true, fresh: true };
}

function quintVersion(bin) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 60000, shell: process.platform === "win32" });
  const out = `${r.stdout || ""} ${r.stderr || ""}`.trim();
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : out.split("\n")[0].trim();
}

function runQuintStage(bin, args, opts = {}) {
  const timeout = (opts.timeoutSeconds || 600) * 1000;
  const r = spawnSync(bin, args, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  return {
    status: r.status,
    timedOut: !!(r.error && r.error.code === "ETIMEDOUT"),
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    command: `quint ${args.join(" ")}`,
  };
}

// ---------------------------------------------------------------- verdict logic (the honesty core)

// Gate record (v0.2): { gate, ok: true|false, status: "passed"|"failed"|"skipped-*", detail }.
// Rules (fail-closed, mirrors references/pipeline.md):
//   - any gate failed/vacuous/error             -> FAIL
//   - any gate record missing an explicit status -> FAIL (pre-v0.2 records
//     lack status; a verdict computed from them would be a naked verdict)
//   - verify skipped for ANY reason              -> cap at PASS-WITHOUT-EXHAUSTIVE
//   - simulate/test skipped by flag              -> cap at PASS-WITHOUT-EXHAUSTIVE
//     (the run executed strictly less than the full pipeline; say so)
//   - every gate passed incl. verify             -> PASS
// Unknown or malformed gate records FAIL. Never default to ok.
const KNOWN_GATE_STATUSES = new Set(["passed", "failed", "skipped-by-flag", "skipped-no-java21"]);
function gateVerdict(stageOutputs) {
  if (!Array.isArray(stageOutputs) || stageOutputs.length === 0) return "FAIL";
  let capped = false;
  for (const s of stageOutputs) {
    if (!s || typeof s !== "object") return "FAIL";
    if (s.ok === false) return "FAIL";
    if (s.ok !== true) return "FAIL"; // fail-closed: missing ok is a failure
    const st = typeof s.status === "string" ? s.status : null;
    if (st === null || !KNOWN_GATE_STATUSES.has(st)) return "FAIL"; // missing/unknown status: fail-closed
    if (st === "failed") return "FAIL";
    if (st.startsWith("skipped")) capped = true;
    if (s.gate === "verify" && st !== "passed") capped = true;
  }
  return capped ? "PASS-WITHOUT-EXHAUSTIVE" : "PASS";
}

// Aggregate verdict across models. PASS requires every model PASS. Any
// PASS-WITHOUT-EXHAUSTIVE anywhere caps the aggregate at that level.
function aggregateVerdict(verdicts) {
  if (!Array.isArray(verdicts) || verdicts.length === 0) return "FAIL";
  if (verdicts.some((v) => v !== "PASS" && v !== "PASS-WITHOUT-EXHAUSTIVE")) return "FAIL";
  if (verdicts.some((v) => v === "PASS-WITHOUT-EXHAUSTIVE")) return "PASS-WITHOUT-EXHAUSTIVE";
  return "PASS";
}

// ---------------------------------------------------------------- misc

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

module.exports = {
  loadConfig, quintBin, ensureQuintInstalled, quintVersion,
  runQuintStage, nowIso, ensureDir, writeJson, gateVerdict, aggregateVerdict,
  sha256File, sha256String, gitCommit, gitDirty, detectJava, javaMajorOfLine,
  execSync, fs, path, os,
};
