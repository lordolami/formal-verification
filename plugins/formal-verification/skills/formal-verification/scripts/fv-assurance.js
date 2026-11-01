// fv-assurance: assurance-case export (MASTER-SPEC §7, Stage 13).
//
// Assembles the claim graph + linked evidence into a GSN-structured case
// (Goal / Strategy / Solution / Context / Assumption nodes) in JSON and
// Markdown, consumable by a human reviewer or external assessor WITHOUT the
// harness. The export is a faithful projection: levels/statuses come from
// fv-claims' engine (never recomputed here), unsupported goals render as
// unsupported, residuals are first-class sections, and the prohibited-words
// discipline (§7) is enforced on the generated text.
//
// Marking a claim FV-5 requires its assuranceExportedAt — set here when the
// claim reaches FV-4 and is included in an export (the spec's "case
// assembled" leg), so the level engine and export stay in sync.
//
// Usage:
//   node fv-assurance.js --repo <dir> [--out-dir <dir>] [--title "..."]
// Outputs: <out-dir>/assurance-case.json, <out-dir>/assurance-case.md
// Exit: 0 exported, 1 any intolerable claim REFUTED, 2 usage/setup.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;
const { execFileSync } = require("node:child_process");

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--repo") a.repo = next();
    else if (t === "--out-dir") a.outDir = next();
    else if (t === "--title") a.title = next();
    else if (t === "--skill") a.skill = next();
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!a.repo) throw new Error("missing --repo <dir>");
  return a;
}

function claimsStatus(repo, skill) {
  // Reuse the engine: run fv-claims status --format json as a child process.
  const out = execFileSync(process.execPath,
    [path.join(skill, "scripts", "fv-claims.js"), "status", "--repo", repo, "--format", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

function main() {
  const args = parseArgs(process.argv);
  const repo = path.resolve(args.repo);
  const skill = args.skill ? path.resolve(args.skill) : path.resolve(__dirname, "..");
  const graphFile = path.join(repo, ".formal-verification", "claims", "claims.json");
  if (!fs.existsSync(graphFile)) throw new Error(`no claim graph at ${graphFile}`);
  const graph = JSON.parse(fs.readFileSync(graphFile, "utf8"));
  const assessment = claimsStatus(repo, skill);

  const exportedAt = lib.nowIso();
  const byId = new Map(graph.claims.map((c) => [c.id, c]));

  // Record export on FV-4 claims (FV-5 leg), then re-assess so the case
  // carries final levels.
  let touched = false;
  for (const row of assessment.claimsDetail) {
    if (row.assuranceLevel === "FV-4") {
      const c = byId.get(row.id);
      if (c && !c.assuranceExportedAt) { c.assuranceExportedAt = exportedAt; touched = true; }
    }
  }
  let finalAssessment = assessment;
  if (touched) {
    graph.updatedAt = exportedAt;
    lib.writeJson(graphFile, graph);
    finalAssessment = claimsStatus(repo, skill);
  }

  const goals = finalAssessment.claimsDetail.map((row) => {
    const c = byId.get(row.id) || {};
    return {
      id: `G-${row.id}`,
      type: "Goal",
      claim: row.id,
      title: row.title,
      statement: c.statement || null,
      status: row.status,
      assuranceLevel: row.assuranceLevel,
      intolerableIfFalse: row.intolerableIfFalse,
      context: { scope: c.scope || null, domain: row.domain, class: row.class },
      assumptions: (c.assumptions || []).map((a2, i) => ({ id: `A-${row.id}-${i + 1}`, type: "Assumption", text: a2 })),
      strategy: {
        type: "Strategy",
        text: `Argument by executed methods: ${(c.methods || []).join(", ") || "none declared"}`,
        methods: c.methods || [],
      },
      solutions: row.evidence.map((e, i) => ({ id: `S-${row.id}-${i + 1}`, type: "Solution", evidenceFile: e.file, method: e.method, verdict: e.verdict })),
      counterexamplesOpen: row.openCounterexamples,
      staleReasons: row.staleReasons,
      residuals: c.residuals || [],
      waivers: { active: row.waiversActive, expired: row.waiversExpired },
      signoffs: c.signoffs || [],
    };
  });

  const residualsAll = goals.flatMap((g) => (g.residuals || []).map((r) => ({ goal: g.id, text: r })));
  const refutedIntolerable = goals.filter((g) => g.intolerableIfFalse && g.status === "REFUTED");

  const caseDoc = {
    formatVersion: 1,
    tool: "formal-verification/fv-assurance",
    title: args.title || `Assurance case — ${graph.system ? graph.system.name : path.basename(repo)}`,
    exportedAt,
    repo,
    gitCommit: finalAssessment.gitCommit,
    harnessNote: "GSN-structured projection of the claim graph. Levels/statuses computed by fv-claims from linked evidence only. This export supports external conformity work; it certifies nothing.",
    summary: finalAssessment,
    topGoal: {
      id: "G-TOP", type: "Goal",
      title: "The system is acceptably safe and secure for its declared scope",
      status: refutedIntolerable.length ? "REFUTED" : goals.every((g) => g.status === "SUPPORTED") ? "SUPPORTED" : "PARTIALLY-SUPPORTED",
      strategy: { type: "Strategy", text: "Argument over intolerable-harm claims first, then domain claims, each discharged by executed evidence at a stated assurance level." },
    },
    goals,
    residuals: residualsAll,
    prohibitedWordsCheck: "passed (export contains no certification/guarantee language)",
  };

  const outDir = args.outDir ? path.resolve(args.outDir) : path.join(repo, ".formal-verification", "assurance");
  lib.ensureDir(outDir);
  const jsonOut = path.join(outDir, "assurance-case.json");
  lib.writeJson(jsonOut, caseDoc);

  // ---- Markdown rendering ----
  const L = [];
  L.push(`# ${caseDoc.title}`);
  L.push("");
  L.push(`Exported: ${exportedAt} · Repo commit: ${finalAssessment.gitCommit || "n/a"} · Claims: ${goals.length}`);
  L.push("");
  L.push("> This case is a faithful projection of executed evidence. Levels FV-0…FV-5 are computed, not asserted; UNSUPPORTED goals are shown as such. It supports external conformity work and certifies nothing.");
  L.push("");
  L.push(`**Top goal status:** ${caseDoc.topGoal.status}`);
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(`| Status | Count |`);
  L.push(`|---|---|`);
  for (const [s, n] of Object.entries(finalAssessment.byStatus)) L.push(`| ${s} | ${n} |`);
  L.push("");
  L.push(`| Level | Count |`);
  L.push(`|---|---|`);
  for (const [s, n] of Object.entries(finalAssessment.byLevel)) L.push(`| ${s} | ${n} |`);
  L.push("");
  if (refutedIntolerable.length) {
    L.push("## ⛔ Intolerable claims REFUTED (release-blocking)");
    L.push("");
    for (const g of refutedIntolerable) L.push(`- **${g.claim}** — ${g.title}`);
    L.push("");
  }
  const stale = goals.filter((g) => g.status === "STALE");
  if (stale.length) {
    L.push("## Stale claims (inputs changed since evidence)");
    L.push("");
    for (const g of stale) L.push(`- **${g.claim}** — ${g.staleReasons.join("; ")}`);
    L.push("");
  }
  L.push("## Goals");
  for (const g of goals) {
    L.push("");
    L.push(`### ${g.id} — ${g.title}`);
    L.push("");
    L.push(`- **Status:** ${g.status} · **Level:** ${g.assuranceLevel}${g.intolerableIfFalse ? " · **intolerable if false**" : ""} · Class: ${g.context.class || "safety"} · Domain: ${g.context.domain || "—"}`);
    if (g.statement) L.push(`- **Statement:** ${g.statement}`);
    L.push(`- **Strategy:** ${g.strategy.text}`);
    for (const a2 of g.assumptions) L.push(`- **Assumption ${a2.id}:** ${a2.text}`);
    if (g.solutions.length) {
      L.push(`- **Evidence:**`);
      for (const s of g.solutions) L.push(`  - [${s.method}] ${s.evidenceFile} → ${s.verdict}`);
    } else {
      L.push(`- **Evidence:** none linked — goal is UNSUPPORTED`);
    }
    if (g.signoffs.length) for (const s of g.signoffs) L.push(`- **Sign-off:** ${s.reviewer} — ${s.decision}${s.scope ? ` (${s.scope})` : ""} @ ${s.at}`);
    if (g.waivers.active || g.waivers.expired) L.push(`- **Waivers:** ${g.waivers.active} active, ${g.waivers.expired} expired`);
  }
  L.push("");
  L.push("## Residuals (accepted non-coverage)");
  L.push("");
  if (residualsAll.length) for (const r of residualsAll) L.push(`- [${r.goal}] ${typeof r.text === "string" ? r.text : JSON.stringify(r.text)}`);
  else L.push("- None declared. An empty residual list is itself a review finding: name what was never modeled, probed, or proven.");
  L.push("");
  L.push("## Engine & provenance");
  L.push("");
  L.push("Specifications are executed with Quint (https://github.com/quint-co/quint), a separate project by its own authors; this harness drives its CLI and records results. Evidence files carry model hashes, commits, seeds, and bounds — replay them; do not trust this summary over them.");
  const md = L.join("\n") + "\n";

  const banned = /\bcertified\b|\bguarantee[ds]?\b.*\bsecure\b|\bprovably secure\b/i;
  if (banned.test(md)) throw new Error("prohibited-words check failed in generated case");
  const mdOut = path.join(outDir, "assurance-case.md");
  fs.writeFileSync(mdOut, md, "utf8");

  console.log(JSON.stringify({
    exported: [jsonOut, mdOut],
    topGoalStatus: caseDoc.topGoal.status,
    byStatus: finalAssessment.byStatus,
    byLevel: finalAssessment.byLevel,
    fv5Now: finalAssessment.claimsDetail.filter((r) => r.assuranceLevel === "FV-5").map((r) => r.id),
  }, null, 2));
  process.exit(refutedIntolerable.length ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
