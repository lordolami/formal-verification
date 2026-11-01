// fv-scan: scanner fusion as hypotheses (MASTER-SPEC method: scan-fusion;
// SECURITY.md §6 mapping honesty).
//
// Scanners (Semgrep, CodeQL, Snyk, OSV...) find candidate problems. They do
// not execute claims. fv-scan imports their output (SARIF 2.1.0, OSV JSON,
// or a plain secret-scan hit list) and lands every finding as a HYPOTHESIS
// linked to candidate catalog claims — promoted to FINDING only when a
// human or a probe/model execution confirms it (recorded in the triage
// file). Unmapped findings are scope gaps, stated as such. Scanner output
// NEVER raises an assurance level by itself.
//
// Inputs (repeat flags freely):
//   --sarif <file.sarif>   --osv <file.json>   --secrets <file.json>
// Secrets file shape: { "hits": [ { "file": "...", "line": 1, "kind": "aws-key|generic", "redacted": "AKIA…" } ] }
//   Values are never read beyond the redacted prefix you supply.
//
// Triage: --triage <triage.json> { "confirmations": [ { "hypothesis": "HYP-001", "by": "probe|model|human", "evidence": "<file>", "note": "..." } ] }
//
// Output: .formal-verification/scans/fusion.json + evidence-format record.
// Exit: 0 fusion complete (hypotheses recorded), 1 unconfirmed CRITICAL
// hypotheses exist and --strict, 2 usage/setup. Default exit is 0: hypotheses
// are information, not verdicts — strict mode is for CI gates that opt in.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

function parseArgs(argv) {
  const a = { sarif: [], osv: [], secrets: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--repo") a.repo = next();
    else if (t === "--sarif") a.sarif.push(next());
    else if (t === "--osv") a.osv.push(next());
    else if (t === "--secrets") a.secrets.push(next());
    else if (t === "--triage") a.triage = next();
    else if (t === "--out") a.out = next();
    else if (t === "--strict") a.strict = true;
    else throw new Error(`unknown argument: ${t}`);
  }
  return a;
}

// Rule-id / CWE -> candidate claims (classification, not coverage).
const CLAIM_HINTS = [
  { re: /(bola|idor|broken-object|object-level|authoriz)/i, claims: ["CLM-AUTHZ-004", "CLM-ISO-001"] },
  { re: /(auth|session|token|jwt|credential|password)/i, claims: ["CLM-AUTHZ-002", "CLM-AUTHZ-003", "CLM-AUTHZ-011"] },
  { re: /(mass-assign|property-level|excessive-data)/i, claims: ["CLM-AUTHZ-006"] },
  { re: /(injection|sqli|nosqli|xpath|ldap)/i, claims: ["CLM-AUTHZ-007"] },
  { re: /(secret|hardcoded|api[-_ ]?key|private[-_ ]?key)/i, claims: ["CLM-PLAT-005"] },
  { re: /(ssrf|request-forgery)/i, claims: ["CLM-AUTHZ-001"] },
  { re: /(path|traversal|directory)/i, claims: ["CLM-PLAT-001", "CLM-AUTHZ-004"] },
  { re: /(upload|file-type|unrestricted)/i, claims: ["CLM-PLAT-001"] },
  { re: /(rate|dos|resource|exhaust)/i, claims: ["CLM-PLAT-004", "CLM-AUTHZ-010"] },
  { re: /(crypto|tls|certificate|random)/i, claims: ["CLM-PLAT-006"] },
];

function hintsFor(text) {
  const found = new Set();
  for (const h of CLAIM_HINTS) if (h.re.test(text)) for (const c of h.claims) found.add(c);
  return [...found];
}

function fromSarif(file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  for (const run of doc.runs || []) {
    const rules = new Map();
    const driver = run.tool && run.tool.driver;
    for (const r of (driver && driver.rules) || []) rules.set(r.id, r);
    for (const res of run.results || []) {
      const rule = rules.get(res.ruleId) || {};
      const loc = (res.locations && res.locations[0] && res.locations[0].physicalLocation) || {};
      out.push({
        source: "sarif", tool: (driver && driver.name) || "unknown",
        ruleId: res.ruleId || "(none)",
        level: res.level || (rule.defaultConfiguration && rule.defaultConfiguration.level) || "warning",
        message: (res.message && res.message.text || "").slice(0, 300),
        file: loc.artifactLocation ? loc.artifactLocation.uri : null,
        line: loc.region ? loc.region.startLine : null,
        cwe: [...((rule.properties && rule.properties.tags) || [])].filter((t) => /cwe/i.test(String(t))),
        candidateClaims: hintsFor(`${res.ruleId} ${rule.name || ""} ${res.message && res.message.text || ""}`),
      });
    }
  }
  return out;
}

function fromOsv(file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const results = doc.results || doc.vulns || [];
  const out = [];
  for (const r of results) {
    const vulns = r.vulnerabilities || (r.id ? [r] : []);
    const pkgs = r.packages || [];
    for (const v of vulns) {
      out.push({
        source: "osv", tool: "osv",
        ruleId: v.id || (v.aliases && v.aliases[0]) || "(osv)",
        level: "error",
        message: String(v.summary || v.id || "vulnerable dependency").slice(0, 300),
        file: pkgs.map((p) => `${p.package ? p.package.name : "?"}@${p.package ? p.package.version : "?"}`).join(", ") || null,
        line: null,
        cwe: [],
        candidateClaims: hintsFor(`${v.id} ${v.summary || ""}`),
      });
    }
  }
  return out;
}

function fromSecrets(file) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  return (doc.hits || []).map((h) => ({
    source: "secrets", tool: "secret-scan",
    ruleId: `secret:${h.kind || "generic"}`,
    level: "error",
    message: `possible secret in source (redacted: ${h.redacted || "…"})`,
    file: h.file || null, line: h.line || null,
    cwe: ["CWE-798"],
    candidateClaims: ["CLM-PLAT-005"],
  }));
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const startedAt = lib.nowIso();

  let hypotheses = [];
  for (const f of args.sarif) hypotheses = hypotheses.concat(fromSarif(path.resolve(f)));
  for (const f of args.osv) hypotheses = hypotheses.concat(fromOsv(path.resolve(f)));
  for (const f of args.secrets) hypotheses = hypotheses.concat(fromSecrets(path.resolve(f)));
  hypotheses = hypotheses.map((h, i) => ({ id: `HYP-${String(i + 1).padStart(3, "0")}`, status: "HYPOTHESIS", ...h }));

  let triage = { confirmations: [] };
  if (args.triage) triage = JSON.parse(fs.readFileSync(path.resolve(args.triage), "utf8"));
  for (const conf of triage.confirmations || []) {
    const h = hypotheses.find((x) => x.id === conf.hypothesis);
    if (h) { h.status = "FINDING"; h.confirmation = { by: conf.by, evidence: conf.evidence || null, note: conf.note || null }; }
  }

  const unmapped = hypotheses.filter((h) => h.candidateClaims.length === 0);
  const criticalOpen = hypotheses.filter((h) => h.status === "HYPOTHESIS" && (h.level === "error"));
  const fusion = {
    tool: "formal-verification/fv-scan",
    formatVersion: 2,
    startedAt, finishedAt: lib.nowIso(),
    repo, gitCommit: lib.gitCommit(repo),
    totals: { hypotheses: hypotheses.length, findings: hypotheses.filter((h) => h.status === "FINDING").length, unmapped: unmapped.length },
    hypotheses,
    honesty: "Scanner outputs are hypotheses, not findings, until executed evidence confirms them. Unmapped hypotheses are scope gaps. This fusion never raises an assurance level by itself; confirm via fv-probe/fv-run and link with fv-claims.",
  };
  const out = args.out || path.join(repo, ".formal-verification", "scans", "fusion.json");
  lib.writeJson(out, fusion);

  const evidence = {
    tool: "formal-verification/fv-scan",
    formatVersion: 2,
    target: repo,
    startedAt, finishedAt: lib.nowIso(),
    quintExpected: null, quintActual: null, setupError: null,
    provenance: { gitCommit: fusion.gitCommit, node: process.version, platform: `${os.platform()} ${os.arch()}`, fusionFile: out },
    gates: [{ gate: "scan-fusion", ok: true, status: "passed", detail: fusion.totals }],
    hypotheses: hypotheses.length,
    verdict: "PASS",
    note: "PASS here means the fusion executed and recorded hypotheses. It is NOT a security verdict. See hypotheses[].status.",
  };
  lib.writeJson(path.join(repo, ".formal-verification", "evidence", `scan-${stamp()}.json`), evidence);

  console.log(JSON.stringify({
    out, totals: fusion.totals,
    bySource: Object.fromEntries(["sarif", "osv", "secrets"].map((s) => [s, hypotheses.filter((h) => h.source === s).length])),
    unmappedIds: unmapped.map((h) => h.id),
    strictGate: args.strict ? (criticalOpen.length ? `FAIL (${criticalOpen.length} unconfirmed error-level hypotheses)` : "PASS") : "off",
  }, null, 2));
  process.exit(args.strict && criticalOpen.length ? 1 : 0);

  function stamp() { return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", ""); }
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
