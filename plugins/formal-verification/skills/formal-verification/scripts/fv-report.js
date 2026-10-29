// fv-report: aggregate one or more fv-run evidence files into a verdict report.
// Usage:
//   node fv-report.js --evidence <a.json> [--evidence <b.json>...] [--format text|json]
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
  const records = files.map((f) => JSON.parse(fs.readFileSync(path.resolve(f), "utf8")));
  const summary = {
    tool: "formal-verification/fv-report",
    generatedAt: lib.nowIso(),
    models: records.length,
    passed: records.filter((r) => r.verdict === "PASS").length,
    failed: records.filter((r) => r.verdict !== "PASS").length,
    verdict: records.every((r) => r.verdict === "PASS") ? "PASS" : "FAIL",
    details: records.map((r) => ({
      model: r.model,
      verdict: r.verdict,
      quintActual: r.quintActual,
      gates: r.gates.map((g) => ({ gate: g.gate, ok: g.ok })),
    })),
  };
  if (format === "json") {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log("formal-verification report");
  console.log(`generated: ${summary.generatedAt}`);
  console.log(`models: ${summary.models}  passed: ${summary.passed}  failed: ${summary.failed}`);
  console.log(`verdict: ${summary.verdict}`);
  for (const d of summary.details) {
    console.log(`- ${d.model}: ${d.verdict} [${d.gates.map((g) => `${g.gate}=${g.ok ? "ok" : "FAIL"}`).join(", ")}]`);
  }
  process.exit(summary.verdict === "PASS" ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
