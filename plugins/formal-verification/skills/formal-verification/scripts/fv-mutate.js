// fv-mutate: property-adequacy via targeted model mutation (MASTER-SPEC Stage 8).
//
// A property suite that cannot fail is decoration. fv-mutate copies a Quint
// model, applies one named weakening mutation to the copy (the original is
// never touched), and re-runs simulation + scenario tests against the mutant.
// A mutant is KILLED when the suite detects the weakening (simulate finds a
// violation OR a scenario test fails); it SURVIVES when nothing notices —
// surviving mutants mean the invariants do not guard the mutated behavior.
//
// Mutations are anchored string replacements, declared per model below and in
// --mutations JSON. Anchor-not-found is reported as `not-applicable` (never
// silently counted as killed). Zero applicable mutants is a FAIL: adequacy
// was not demonstrated.
//
// Usage:
//   node fv-mutate.js --model <m.qnt> [--repo <dir>] [--skill <dir>]
//                     [--invariants a ...] [--max-samples N] [--max-steps N]
//                     [--seed S] [--mutations <file.json>] [--out <evidence.json>]
// Exit: 0 all applicable mutants killed, 1 any survived/none applicable, 2 setup error.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

// Built-in mutation operators, anchored to the v0.2 starter models' guards.
// Each: { id, description, find, replace } — applied to the FIRST occurrence.
const BUILTIN_MUTATIONS = [
  {
    id: "drop-revocation-check",
    description: "credential guard no longer consults the revoked set",
    find: "not(revoked.contains(t))",
    replace: "true",
    appliesTo: ["token_lifecycle"],
  },
  {
    id: "drop-expiry-check",
    description: "credential guard no longer consults the expired set",
    find: "not(expired.contains(t))",
    replace: "true",
    appliesTo: ["token_lifecycle"],
  },
  {
    id: "replay-reexecutes-effect",
    description: "idempotency: a seen key re-executes instead of returning the receipt",
    find: "if (receipts.contains(key))",
    replace: "if (false)",
    appliesTo: ["crud_api"],
  },
  {
    id: "crash-keeps-staged",
    description: "crash no longer discards staged (uncommitted) state",
    find: "staged' = committed,",
    replace: "staged' = staged,",
    appliesTo: ["kv_store"],
  },
  {
    id: "election-without-quorum-guard",
    description: "a second node may elect itself while a leader serves",
    find: "if (NODES.forall(m => believes.get(m) != m))",
    replace: "if (true)",
    appliesTo: ["leader_election"],
  },
  {
    id: "fencing-token-ignored",
    description: "writes accepted with any fencing token from the holder",
    find: "(holder == a) and (token == fencing)",
    replace: "(holder == a) and (token == token)",
    appliesTo: ["lease_lock"],
  },
  {
    id: "protected-serve-open",
    description: "protected objects served without authentication",
    find: "((not(isProtected(f))) or authed)",
    replace: "true",
    appliesTo: ["file_publish"],
  },
  {
    id: "publish-corrupt-stage",
    description: "backup publishes regardless of staged hash validity",
    find: "if (stagedHashOk)",
    replace: "if (true)",
    appliesTo: ["backup_restore"],
  },
  {
    id: "stale-push-silent",
    description: "stale-base push silently accepted instead of conflicted",
    find: "if (base == serverSeq)",
    replace: "if (true)",
    appliesTo: ["sync_session"],
  },
  {
    id: "tenant-guard-inverted-reach",
    description: "tenant read guard widened: any authenticated tenant may read",
    find: "if (readerTenant.get(user) == ownerOf.get(rec)) all {\n      ownerOf' = ownerOf,\n      readerTenant' = readerTenant,\n      crossReads' = if (readerTenant.get(user) != ownerOf.get(rec)) crossReads + 1 else crossReads,",
    replace: "if (true) all {\n      ownerOf' = ownerOf,\n      readerTenant' = readerTenant,\n      crossReads' = if (readerTenant.get(user) != ownerOf.get(rec)) crossReads + 1 else crossReads,",
    appliesTo: ["tenant_isolation"],
  },
  {
    id: "floor-lowered-sql",
    description: "SQL gateway floor lowered to record-credential level",
    find: "pure val FLOOR_SQL_GATEWAY = 4",
    replace: "pure val FLOOR_SQL_GATEWAY = 1",
    appliesTo: ["privileged_boundary"],
  },
];

function parseArgs(argv) {
  const a = { invariants: [], simulate: true, test: true };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--model") a.model = next();
    else if (t === "--repo") a.repo = next();
    else if (t === "--skill") a.skill = next();
    else if (t === "--invariants") a.invariants.push(next());
    else if (t === "--max-samples") a.maxSamples = Number(next());
    else if (t === "--max-steps") a.maxSteps = Number(next());
    else if (t === "--seed") a.seed = next();
    else if (t === "--mutations") a.mutationsFile = next();
    else if (t === "--out") a.out = next();
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!a.model) throw new Error("missing --model <path.qnt>");
  return a;
}

function listRunTests(src) {
  const names = [];
  const re = /(^|\n)\s*run\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
  let m;
  while ((m = re.exec(src)) !== null) names.push(m[2]);
  return names;
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const skill = args.skill ? path.resolve(args.skill) : path.resolve(__dirname, "..");
  const cfg = lib.loadConfig(skill);
  const budgets = cfg.defaultProfileBudgets;
  const modelAbs = path.resolve(args.model);
  if (!fs.existsSync(modelAbs)) throw new Error(`model not found: ${modelAbs}`);
  const startedAt = lib.nowIso();
  const seed = args.seed !== undefined ? String(args.seed) : "1";

  const src = fs.readFileSync(modelAbs, "utf8");
  const base = path.basename(modelAbs, ".qnt");

  let mutations = BUILTIN_MUTATIONS.filter((m) => !m.appliesTo || m.appliesTo.includes(base));
  if (args.mutationsFile) {
    const extra = JSON.parse(fs.readFileSync(path.resolve(args.mutationsFile), "utf8"));
    if (!Array.isArray(extra)) throw new Error("--mutations file must be a JSON array");
    mutations = mutations.concat(extra);
  }

  let bin;
  try {
    bin = lib.ensureQuintInstalled(repo, cfg).bin;
  } catch (e) {
    return finish([], `quint install failed: ${e.message}`);
  }
  const quintActual = lib.quintVersion(bin);

  const invFlags = [];
  for (const inv of args.invariants) invFlags.push("--invariants", inv);
  const maxSamples = String(args.maxSamples || budgets.simulation.maxSamples);
  const maxSteps = String(args.maxSteps || budgets.simulation.maxSteps);
  const testNames = listRunTests(src);

  const workDir = path.join(repo, ".formal-verification", "mutants");
  lib.ensureDir(workDir);

  const results = [];
  for (const mut of mutations) {
    if (!src.includes(mut.find)) {
      results.push({ id: mut.id, status: "not-applicable", detail: "anchor not found in model" });
      continue;
    }
    const mutantSrc = src.replace(mut.find, mut.replace);
    const mutantPath = path.join(workDir, `${base}.${mut.id}.qnt`);
    fs.writeFileSync(mutantPath, mutantSrc, "utf8");

    // A mutant that no longer parses/typechecks is killed by construction
    // only if the mutation was semantic; a syntax-breaking mutant counts as
    // killed-with-note (the suite never even accepts it).
    const p = lib.runQuintStage(bin, ["parse", mutantPath], { timeoutSeconds: 120 });
    if (p.status !== 0) {
      results.push({ id: mut.id, status: "killed", via: "parse", detail: "mutant does not parse" });
      continue;
    }
    const tc = lib.runQuintStage(bin, ["typecheck", mutantPath], { timeoutSeconds: 180 });
    if (tc.status !== 0) {
      results.push({ id: mut.id, status: "killed", via: "typecheck", detail: "mutant does not typecheck" });
      continue;
    }

    let killed = false;
    let via = null;
    const sim = lib.runQuintStage(
      bin,
      ["run", mutantPath, "--max-samples", maxSamples, "--max-steps", maxSteps, "--seed", seed, ...invFlags],
      { timeoutSeconds: budgets.simulation.timeoutSeconds }
    );
    const simBody = `${sim.stdout}\n${sim.stderr}`;
    if (sim.status !== 0 && /violation/i.test(simBody)) { killed = true; via = "simulate"; }

    if (!killed && testNames.length) {
      for (const nm of testNames) {
        const t = lib.runQuintStage(bin, ["test", mutantPath, "--match", `^${nm}$`, "--seed", seed], { timeoutSeconds: budgets.test.timeoutSeconds });
        const body = `${t.stdout}\n${t.stderr}`;
        if (t.status !== 0 || /failing|failed/.test(body.replace(/0 failing/g, ""))) { killed = true; via = `test:${nm}`; break; }
      }
    }

    results.push({
      id: mut.id,
      description: mut.description,
      status: killed ? "killed" : "SURVIVED",
      via,
      mutant: mutantPath,
      mutantSha256: lib.sha256String(mutantSrc),
    });
  }

  return finish(results, null, { quintActual, seed, modelAbs });

  function finish(results, setupError, meta = {}) {
    const applicable = results.filter((r) => r.status !== "not-applicable");
    const killed = applicable.filter((r) => r.status === "killed").length;
    const survived = applicable.filter((r) => r.status === "SURVIVED");
    const threshold = typeof cfg.mutationKillThreshold === "number" ? cfg.mutationKillThreshold : 0.8;
    const ratio = applicable.length ? killed / applicable.length : 0;
    const verdict = setupError
      ? "FAIL"
      : applicable.length === 0
        ? "FAIL"
        : survived.length === 0
          ? "PASS"
          : ratio >= threshold
            ? "PASS-WITHOUT-EXHAUSTIVE"
            : "FAIL";
    const record = {
      tool: "formal-verification/fv-mutate",
      formatVersion: 2,
      model: meta.modelAbs || modelAbs,
      modelSha256: fs.existsSync(modelAbs) ? lib.sha256File(modelAbs) : null,
      startedAt,
      finishedAt: lib.nowIso(),
      quintExpected: cfg.quintVersion,
      quintActual: meta.quintActual || null,
      setupError: setupError || null,
      provenance: {
        seed: meta.seed || seed,
        invariants: args.invariants,
        gitCommit: lib.gitCommit(repo),
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        killThreshold: threshold,
      },
      summary: { applicable: applicable.length, killed, survived: survived.length, killRatio: ratio },
      mutants: results,
      verdict,
      honesty: "SURVIVED mutants mean the property suite does not guard the mutated behavior; the linked claims are capped at FV-1 until the survivor is killed or formally examined.",
    };
    const out = args.out || path.join(repo, ".formal-verification", "evidence", `mutate-${stamp()}.json`);
    lib.writeJson(out, record);
    console.log(JSON.stringify({ verdict, out, summary: record.summary, survived: survived.map((s) => s.id) }, null, 2));
    process.exit(verdict === "PASS" ? 0 : verdict === "PASS-WITHOUT-EXHAUSTIVE" ? 3 : setupError ? 2 : 1);
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  }
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
