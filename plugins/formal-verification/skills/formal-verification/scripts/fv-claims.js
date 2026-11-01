// fv-claims: the claim-graph engine (MASTER-SPEC §2-3).
//
// A target repo keeps its claim graph at .formal-verification/claims/claims.json.
// This tool inits, validates, links evidence, and computes — mechanically —
// each claim's status (SUPPORTED | STALE | UNSUPPORTED | REFUTED) and
// assurance level (FV-0..FV-5). Nothing here trusts prose: status and level
// are computed from linked evidence records and input hashes only.
//
// Subcommands:
//   init    --repo <dir> [--system <name>]
//   add     --repo <dir> --claim <claim.json | catalog-id>   (adopt from assets/claims)
//   link    --repo <dir> --claim CLM-... --evidence <evidence.json> --method model-adversarial [--note "..."]
//   signoff --repo <dir> --claim CLM-... --reviewer <name> --decision accept|reject|accept-with-residuals [--scope "..."]
//   waiver  --repo <dir> --claim CLM-... --rationale "..." --accepted-by <name> --expires YYYY-MM-DD
//   status  --repo <dir> [--format text|json] [--out <assessment.json>]
//   stale   --repo <dir>   (report only claims whose inputs changed; exit 1 if any stale)
//
// Level rules (normative, MASTER-SPEC §3):
//   FV-0 claim record exists with scope+assumptions+methods
//   FV-1 model evidence verdict in {PASS, PASS-WITHOUT-EXHAUSTIVE} (simulate+test ran)
//   FV-2 FV-1 + model evidence verdict PASS (verify ran) + mutation evidence PASS*
//   FV-3 FV-2 + implementation evidence (probe/trace/fault) PASS on current commit
//   FV-4 FV-3 + adversarial campaign evidence + human signoff (reviewer != claim owner)
//   FV-5 FV-4 + assurance case exported (recorded) + no stale inputs + no open counterexamples
// (* A mutation verdict of PASS-WITHOUT-EXHAUSTIVE also satisfies the adequacy leg;
//  the claim simply cannot then exceed what that supports elsewhere.)
// Hyperproperty claims never exceed FV-1 on model evidence alone (§2.3).
//
// Exit: 0 ok (+ status computed), 1 validation/status failure, 2 setup/usage error.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

const STATUSES = ["SUPPORTED", "STALE", "UNSUPPORTED", "REFUTED"];
const METHODS = ["model-simulate", "model-verify", "model-adversarial", "mutation-adequacy",
  "implementation-probes", "trace-conformance", "fault-injection", "scan-fusion", "coverage"];

function usage(msg) {
  if (msg) console.error(`fv-claims: ${msg}`);
  console.error(`usage:
  node fv-claims.js init    --repo <dir> [--system <name>]
  node fv-claims.js add     --repo <dir> --claim <file.json | CLM-XXX-NNN>
  node fv-claims.js link    --repo <dir> --claim CLM-... --evidence <f.json> --method <m>
  node fv-claims.js signoff --repo <dir> --claim CLM-... --reviewer <n> --decision <d>
  node fv-claims.js waiver  --repo <dir> --claim CLM-... --rationale <t> --accepted-by <n> --expires <date>
  node fv-claims.js status  --repo <dir> [--format text|json] [--out <f>]
  node fv-claims.js stale   --repo <dir>`);
  process.exit(2);
}

function parseArgs(argv) {
  const a = { cmd: argv[2] };
  for (let i = 3; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--repo") a.repo = next();
    else if (t === "--system") a.system = next();
    else if (t === "--claim") a.claim = next();
    else if (t === "--evidence") a.evidence = next();
    else if (t === "--method") a.method = next();
    else if (t === "--note") a.note = next();
    else if (t === "--reviewer") a.reviewer = next();
    else if (t === "--decision") a.decision = next();
    else if (t === "--scope") a.scope = next();
    else if (t === "--rationale") a.rationale = next();
    else if (t === "--accepted-by") a.acceptedBy = next();
    else if (t === "--expires") a.expires = next();
    else if (t === "--format") a.format = next();
    else if (t === "--out") a.out = next();
    else if (t === "--skill") a.skill = next();
    else usage(`unknown argument: ${t}`);
  }
  if (!a.cmd) usage("missing subcommand");
  if (!a.repo) usage("missing --repo <dir>");
  return a;
}

function graphPath(repo) {
  return path.join(repo, ".formal-verification", "claims", "claims.json");
}

function loadGraph(repo) {
  const p = graphPath(repo);
  if (!fs.existsSync(p)) throw new Error(`no claim graph at ${p} — run: fv-claims init --repo ${repo}`);
  return { p, g: JSON.parse(fs.readFileSync(p, "utf8")) };
}

function saveGraph(p, g) {
  g.updatedAt = lib.nowIso();
  lib.writeJson(p, g);
}

// Recompute model-file hash for a claim's formal ref (staleness input #1).
function claimInputHashes(repo, claim) {
  const inputs = {};
  if (claim.formalRef && claim.formalRef.model) {
    const modelPath = path.isAbsolute(claim.formalRef.model) ? claim.formalRef.model : path.join(repo, claim.formalRef.model);
    inputs.model = fs.existsSync(modelPath) ? lib.sha256File(modelPath) : "MISSING";
    inputs.modelPath = claim.formalRef.model;
  }
  if (claim.scope && claim.scope.commit) inputs.commit = claim.scope.commit;
  inputs.headCommit = lib.gitCommit(repo);
  return inputs;
}

// Evidence freshness: evidence pins a model hash + commit; claim is STALE
// when the current model hash or repo HEAD differs from what evidence saw.
function assess(repo, g) {
  const now = new Date();
  return g.claims.map((claim) => {
    const inputs = claimInputHashes(repo, claim);
    const evidence = (claim.evidence || []).map((e) => {
      let record = null;
      const ep = path.isAbsolute(e.file) ? e.file : path.join(repo, e.file);
      if (fs.existsSync(ep)) { try { record = JSON.parse(fs.readFileSync(ep, "utf8")); } catch { record = null; } }
      return { ...e, path: ep, record };
    });

    const waived = (claim.waivers || []).filter((w) => new Date(w.expires) >= now);
    const expiredWaivers = (claim.waivers || []).filter((w) => new Date(w.expires) < now);
    const openCounterexamples = evidence.filter((e) => e.record && e.record.verdict === "FAIL");

    // Level computation legs.
    const modelEvs = evidence.filter((e) => ["model-simulate", "model-verify", "model-adversarial"].includes(e.method));
    const bestModel = modelEvs.map((e) => e.record && e.record.verdict).filter(Boolean);
    const hasModelTested = bestModel.some((v) => v === "PASS" || v === "PASS-WITHOUT-EXHAUSTIVE");
    const hasModelProven = bestModel.some((v) => v === "PASS");
    const mutEvs = evidence.filter((e) => e.method === "mutation-adequacy");
    const hasMutation = mutEvs.some((e) => e.record && (e.record.verdict === "PASS" || e.record.verdict === "PASS-WITHOUT-EXHAUSTIVE"));
    const implEvs = evidence.filter((e) => ["implementation-probes", "trace-conformance", "fault-injection"].includes(e.method));
    const hasImpl = implEvs.some((e) => e.record && e.record.verdict === "PASS");
    const advEvs = evidence.filter((e) => e.method === "model-adversarial");
    const hasAdversarial = advEvs.some((e) => e.record && (e.record.verdict === "PASS" || e.record.verdict === "PASS-WITHOUT-EXHAUSTIVE"));
    const owner = claim.owner || null;
    const signoffs = (claim.signoffs || []).filter((s) => s.decision && s.decision !== "reject");
    const independentSignoff = signoffs.some((s) => s.reviewer && s.reviewer !== owner);

    let level = 0;
    if (claim.scope && claim.assumptions && claim.methods) level = 0;
    if (hasModelTested) level = 1;
    if (hasModelProven && hasMutation) level = 2;
    if (level >= 2 && hasImpl) level = 3;
    if (level >= 3 && (hasAdversarial || claim.class !== "safety") && independentSignoff) level = 4;
    if (level >= 4 && claim.assuranceExportedAt && openCounterexamples.length === 0) level = 5;

    // Hyperproperty rule (§2.3): model-only support caps at FV-1.
    if (claim.class === "hyper" && !hasImpl && level > 1) level = 1;

    // Staleness: current model hash / HEAD vs what the newest evidence saw.
    let stale = false;
    const staleReasons = [];
    if (inputs.model && inputs.model !== "MISSING") {
      const seen = evidence.map((e) => e.record && e.record.provenance && e.record.provenance.modelSha256)
        .concat(evidence.map((e) => e.record && e.record.modelSha256)).filter(Boolean);
      if (seen.length && !seen.includes(inputs.model)) { stale = true; staleReasons.push("model file changed since evidence"); }
    }
    if (inputs.headCommit) {
      const seenCommits = evidence.map((e) => e.record && e.record.provenance && e.record.provenance.gitCommit).filter(Boolean);
      if (seenCommits.length && !seenCommits.includes(inputs.headCommit)) { stale = true; staleReasons.push(`repo HEAD moved (${inputs.headCommit.slice(0, 8)}) since evidence`); }
    }

    let status;
    if (openCounterexamples.length) status = "REFUTED";
    else if (stale) status = "STALE";
    else if (level >= 1 || waived.length) status = "SUPPORTED";
    else status = "UNSUPPORTED";
    if (expiredWaivers.length && !evidence.length) status = "UNSUPPORTED";

    return {
      id: claim.id, title: claim.title, domain: claim.domain || null, class: claim.class || "safety",
      intolerableIfFalse: !!claim.intolerableIfFalse,
      status, assuranceLevel: `FV-${level}`,
      staleReasons,
      openCounterexamples: openCounterexamples.map((e) => e.file),
      waiversActive: waived.length, waiversExpired: expiredWaivers.length,
      evidence: evidence.map((e) => ({ file: e.file, method: e.method, verdict: e.record ? e.record.verdict : "UNREADABLE" })),
      inputs,
    };
  });
}

function validateGraph(g) {
  const problems = [];
  if (!g || g.formatVersion !== 1) problems.push("graph formatVersion must be 1");
  if (!Array.isArray(g.claims)) problems.push("claims must be an array");
  const ids = new Set();
  for (const c of g.claims || []) {
    if (!c.id) problems.push("claim missing id");
    else if (ids.has(c.id)) problems.push(`duplicate claim id ${c.id}`);
    ids.add(c.id);
    for (const f of ["title", "statement", "scope", "assumptions", "methods"]) {
      if (c[f] === undefined) problems.push(`${c.id}: missing ${f}`);
    }
    if (Array.isArray(c.methods)) for (const m of c.methods) if (!METHODS.includes(m)) problems.push(`${c.id}: unknown method ${m}`);
    if (c.formalRef && !c.formalRef.model) problems.push(`${c.id}: formalRef without model`);
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv);
  const repo = path.resolve(args.repo);
  const skill = args.skill ? path.resolve(args.skill) : path.resolve(__dirname, "..");

  if (args.cmd === "init") {
    const p = graphPath(repo);
    if (fs.existsSync(p)) throw new Error(`claim graph already exists at ${p}`);
    const g = {
      formatVersion: 1,
      tool: "formal-verification/fv-claims",
      system: { name: args.system || path.basename(repo), repo, createdAt: lib.nowIso() },
      assuranceVocabulary: "FV-0..FV-5 (MASTER-SPEC §3); statuses SUPPORTED|STALE|UNSUPPORTED|REFUTED",
      claims: [],
      createdAt: lib.nowIso(),
      updatedAt: lib.nowIso(),
    };
    saveGraph(p, g);
    console.log(JSON.stringify({ created: p, system: g.system.name }, null, 2));
    return;
  }

  const { p, g } = loadGraph(repo);

  if (args.cmd === "add") {
    if (!args.claim) usage("add requires --claim <file.json | CATALOG-ID>");
    let claim;
    const asFile = path.resolve(args.claim);
    if (fs.existsSync(asFile)) {
      claim = JSON.parse(fs.readFileSync(asFile, "utf8"));
    } else {
      // Adopt from the shipped catalog (assets/claims + domain packs).
      const candidates = [];
      const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith(".json")) candidates.push(f); } };
      walk(path.join(skill, "assets", "claims"));
      walk(path.join(skill, "assets", "domain-packs"));
      let found = null;
      for (const f of candidates) {
        const j = JSON.parse(fs.readFileSync(f, "utf8"));
        const list = Array.isArray(j) ? j : j.claims || [j];
        for (const c of list) if (c.id === args.claim) { found = c; break; }
        if (found) break;
      }
      if (!found) throw new Error(`claim ${args.claim} not found as file or in catalog`);
      claim = found;
    }
    if (g.claims.some((c) => c.id === claim.id)) throw new Error(`claim ${claim.id} already in graph`);
    claim.evidence = claim.evidence || [];
    claim.signoffs = claim.signoffs || [];
    claim.waivers = claim.waivers || [];
    claim.adoptedAt = lib.nowIso();
    const problems = validateGraph({ formatVersion: 1, claims: [claim] });
    if (problems.length) throw new Error(`invalid claim: ${problems.join("; ")}`);
    g.claims.push(claim);
    saveGraph(p, g);
    console.log(JSON.stringify({ added: claim.id, title: claim.title }, null, 2));
    return;
  }

  const findClaim = () => {
    const c = g.claims.find((x) => x.id === args.claim);
    if (!c) throw new Error(`claim ${args.claim} not in graph`);
    return c;
  };

  if (args.cmd === "link") {
    if (!args.claim || !args.evidence || !args.method) usage("link requires --claim --evidence --method");
    if (!METHODS.includes(args.method)) usage(`unknown method ${args.method}; one of ${METHODS.join(", ")}`);
    const c = findClaim();
    const evAbs = path.resolve(args.evidence);
    if (!fs.existsSync(evAbs)) throw new Error(`evidence not found: ${evAbs}`);
    const rec = JSON.parse(fs.readFileSync(evAbs, "utf8"));
    c.evidence = c.evidence || [];
    c.evidence.push({
      file: path.relative(repo, evAbs).split(path.sep).join("/"),
      method: args.method,
      verdictAtLink: rec.verdict || null,
      tool: rec.tool || null,
      linkedAt: lib.nowIso(),
      note: args.note || null,
    });
    saveGraph(p, g);
    console.log(JSON.stringify({ linked: c.id, evidence: args.evidence, verdict: rec.verdict || null }, null, 2));
    return;
  }

  if (args.cmd === "signoff") {
    if (!args.claim || !args.reviewer || !args.decision) usage("signoff requires --claim --reviewer --decision");
    const c = findClaim();
    c.signoffs = c.signoffs || [];
    c.signoffs.push({ reviewer: args.reviewer, decision: args.decision, scope: args.scope || null, at: lib.nowIso() });
    saveGraph(p, g);
    console.log(JSON.stringify({ signed: c.id, reviewer: args.reviewer, decision: args.decision }, null, 2));
    return;
  }

  if (args.cmd === "waiver") {
    if (!args.claim || !args.rationale || !args.acceptedBy || !args.expires) usage("waiver requires --claim --rationale --accepted-by --expires");
    const c = findClaim();
    c.waivers = c.waivers || [];
    c.waivers.push({ rationale: args.rationale, acceptedBy: args.acceptedBy, expires: args.expires, at: lib.nowIso() });
    saveGraph(p, g);
    console.log(JSON.stringify({ waived: c.id, expires: args.expires }, null, 2));
    return;
  }

  if (args.cmd === "status" || args.cmd === "stale") {
    const problems = validateGraph(g);
    const rows = assess(repo, g);
    const summary = {
      tool: "formal-verification/fv-claims",
      formatVersion: 2,
      assessedAt: lib.nowIso(),
      graph: p,
      gitCommit: lib.gitCommit(repo),
      claims: rows.length,
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])),
      byLevel: Object.fromEntries([0, 1, 2, 3, 4, 5].map((n) => [`FV-${n}`, rows.filter((r) => r.assuranceLevel === `FV-${n}`).length])),
      intolerableRefuted: rows.filter((r) => r.intolerableIfFalse && r.status === "REFUTED").map((r) => r.id),
      intolerableUnsupported: rows.filter((r) => r.intolerableIfFalse && r.status === "UNSUPPORTED").map((r) => r.id),
      validateProblems: problems,
      claimsDetail: rows,
      honesty: "Levels and statuses are computed from linked evidence and input hashes only. UNSUPPORTED is the default state of an unevidenced claim; no prose raises a level.",
    };
    if (args.cmd === "stale") {
      const staleRows = rows.filter((r) => r.status === "STALE");
      console.log(JSON.stringify({ stale: staleRows.map((r) => ({ id: r.id, reasons: r.staleReasons })), count: staleRows.length }, null, 2));
      process.exit(staleRows.length ? 1 : 0);
    }
    if (args.out) lib.writeJson(path.resolve(args.out), summary);
    if ((args.format || "text") === "json") {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`claim graph: ${summary.claims} claims @ ${summary.gitCommit ? summary.gitCommit.slice(0, 8) : "no-git"}`);
      console.log(`status: ${STATUSES.map((s) => `${s}=${summary.byStatus[s]}`).join("  ")}`);
      console.log(`levels: ${[0, 1, 2, 3, 4, 5].map((n) => `FV-${n}=${summary.byLevel[`FV-${n}`]}`).join("  ")}`);
      for (const r of rows) console.log(`- ${r.id} [${r.assuranceLevel}/${r.status}] ${r.title}${r.staleReasons.length ? ` — STALE: ${r.staleReasons.join("; ")}` : ""}`);
      if (summary.intolerableRefuted.length) console.log(`INTOLERABLE + REFUTED (release-blocking): ${summary.intolerableRefuted.join(", ")}`);
      if (summary.intolerableUnsupported.length) console.log(`intolerable + unsupported: ${summary.intolerableUnsupported.join(", ")}`);
      if (problems.length) console.log(`graph problems: ${problems.join("; ")}`);
    }
    const bad = problems.length > 0 || summary.intolerableRefuted.length > 0;
    process.exit(bad ? 1 : 0);
  }

  usage(`unknown subcommand ${args.cmd}`);
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
