// fv-report: aggregate evidence files into one verdict report.
// Usage:
//   node fv-report.js --evidence <a.json> [--evidence <b.json>...] [--format text|json]
//
// Understands evidence formatVersion 2 (fv-run, fv-probe) and legacy v1 records
// (read-only; legacy records are reported with their stored verdict and a warning
// that v1 verdicts predate the honesty contract — re-run with fv-run v0.2+).
//
// Verdict semantics (MASTER-SPEC.md): aggregate PASS requires every model PASS.
// Any PASS-WITHOUT-EXHAUSTIVE caps the aggregate. Anything else is FAIL.
// Exit: 0 PASS, 3 PASS-WITHOUT-EXHAUSTIVE, 1 FAIL, 2 usage/setup error.
const lib = require("./lib/fv-lib");
const { fs, path } = lib;

function main() {
  const files = [];
  let format = "text";
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--evidence") files.push(process.argv[++i]);
    else if (process.argv[i] === "--format") format = process.argv[++i];
    else throw new Error(`unknown argument: ${process.argv[i]}`);
  }
  if (!files.length) throw new Error("missing --evidence <file>");
  const records = files.map((f) => ({ file: path.resolve(f), record: JSON.parse(fs.readFileSync(path.resolve(f), "utf8")) }));

  const details = records.map(({ file, record: r }) => {
    const legacy = (r.formatVersion || 1) < 2;
    return {
      file,
      model: r.model || r.target || "(unknown)",
      tool: r.tool || "(unknown tool)",
      formatVersion: r.formatVersion || 1,
      legacy,
      verdict: r.verdict,
      quintActual: r.quintActual || null,
      seed: r.provenance ? r.provenance.seed : null,
      modelSha256: r.provenance ? r.provenance.modelSha256 : null,
      gitCommit: r.provenance ? r.provenance.gitCommit : null,
      gates: (r.gates || []).map((g) => ({ gate: g.gate, ok: g.ok, status: g.status || (g.ok ? "passed" : "failed") })),
    };
  });

  const verdict = lib.aggregateVerdict(details.map((d) => d.verdict));
  const summary = {
    tool: "formal-verification/fv-report",
    generatedAt: lib.nowIso(),
    models: details.length,
    proven: details.filter((d) => d.verdict === "PASS").length,
    testedNotProven: details.filter((d) => d.verdict === "PASS-WITHOUT-EXHAUSTIVE").length,
    failed: details.filter((d) => d.verdict !== "PASS" && d.verdict !== "PASS-WITHOUT-EXHAUSTIVE").length,
    legacyRecords: details.filter((d) => d.legacy).length,
    verdict,
    details,
  };

  if (format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("formal-verification report — No Naked Verdicts: every verdict carries its bounds");
    console.log(`generated: ${summary.generatedAt}`);
    console.log(`models: ${summary.models}  proven(PASS): ${summary.proven}  tested-not-proven: ${summary.testedNotProven}  failed: ${summary.failed}`);
    if (summary.legacyRecords) {
      console.log(`WARNING: ${summary.legacyRecords} legacy (pre-v0.2) evidence record(s): their verdicts predate the honesty contract. Re-run with fv-run v0.2+ before trusting them.`);
    }
    console.log(`verdict: ${summary.verdict}`);
    for (const d of summary.details) {
      const prov = [d.quintActual ? `quint=${d.quintActual}` : null, d.seed ? `seed=${d.seed}` : null, d.modelSha256 ? `sha=${String(d.modelSha256).slice(0, 12)}…` : null].filter(Boolean).join(" ");
      console.log(`- [${d.tool}] ${d.model}: ${d.verdict}${d.legacy ? " (LEGACY)" : ""}${prov ? ` [${prov}]` : ""}`);
      console.log(`    gates: ${d.gates.map((g) => `${g.gate}=${g.status}`).join(", ")}`);
    }
    if (summary.verdict === "PASS-WITHOUT-EXHAUSTIVE") {
      console.log("note: PASS-WITHOUT-EXHAUSTIVE means tested, not proven — exhaustive verification did not run for at least one model. See its verify gate detail.");
    }
  }
  process.exit(verdict === "PASS" ? 0 : verdict === "PASS-WITHOUT-EXHAUSTIVE" ? 3 : 1);
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
