// Shared helpers for the formal-verification pipeline scripts.
// Node >= 20. No external dependencies.

const { spawnSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function loadConfig(skillDir) {
  const p = path.join(skillDir, "scripts", "fv.config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function quintBin(repoRoot) {
  const local = path.join(repoRoot, ".formal-verification", "quint", "node_modules", ".bin", "quint");
  if (fs.existsSync(local)) return local;
  return "quint";
}

function npmCmd() {
  if (process.platform === "win32") return "npm.cmd";
  return "npm";
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
    timedOut: r.error && r.error.code === "ETIMEDOUT",
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    command: `quint ${args.join(" ")}`,
  };
}

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

function gateVerdict(stageOutputs) {
  // stageOutputs: [{ gate, ok, detail }]
  const failed = stageOutputs.find((s) => !s.ok);
  return failed ? "FAIL" : "PASS";
}

module.exports = {
  loadConfig, quintBin, ensureQuintInstalled, quintVersion,
  runQuintStage, nowIso, ensureDir, writeJson, gateVerdict,
  execSync, fs, path, os,
};
