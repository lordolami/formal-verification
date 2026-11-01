// fv-stale: continuous staleness watcher (MASTER-SPEC Stage 14).
//
// Thin wrapper over the claim engine's staleness computation: compares each
// claim's current inputs (model SHA-256, repo HEAD) against what its linked
// evidence saw, prints the delta, exits 1 when anything is STALE. Built to
// run in CI hooks, pre-push, or a scheduler. It changes nothing.
//
// Usage: node fv-stale.js --repo <dir> [--format text|json] [--watch <seconds>]
// --watch re-checks on an interval and prints transitions (Ctrl-C stops);
// each transition is timestamped. No watch mode in CI.

const lib = require("./lib/fv-lib");
const { fs, path } = lib;
const { execFileSync } = require("node:child_process");

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--repo") a.repo = next();
    else if (t === "--format") a.format = next();
    else if (t === "--watch") a.watch = Number(next());
    else if (t === "--skill") a.skill = next();
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!a.repo) throw new Error("missing --repo <dir>");
  return a;
}

function snapshot(repo, skill) {
  const out = execFileSync(process.execPath,
    [path.join(skill, "scripts", "fv-claims.js"), "status", "--repo", repo, "--format", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const s = JSON.parse(out);
  return new Map(s.claimsDetail.map((c) => [c.id, { status: c.status, level: c.assuranceLevel, reasons: c.staleReasons }]));
}

function diff(prev, next) {
  const changes = [];
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (!p) { changes.push({ id, from: "(new)", to: n.status, reasons: n.reasons }); continue; }
    if (p.status !== n.status || p.level !== n.level) changes.push({ id, from: `${p.level}/${p.status}`, to: `${n.level}/${n.status}`, reasons: n.reasons });
  }
  for (const [id] of prev) if (!next.has(id)) changes.push({ id, from: "present", to: "(removed)", reasons: [] });
  return changes;
}

function main() {
  const args = parseArgs(process.argv);
  const repo = path.resolve(args.repo);
  const skill = args.skill ? path.resolve(args.skill) : path.resolve(__dirname, "..");
  const graphFile = path.join(repo, ".formal-verification", "claims", "claims.json");
  if (!fs.existsSync(graphFile)) throw new Error(`no claim graph at ${graphFile}`);

  const check = (prev) => {
    const snap = snapshot(repo, skill);
    const stale = [...snap.entries()].filter(([, v]) => v.status === "STALE").map(([id, v]) => ({ id, reasons: v.reasons }));
    if (args.format === "json") {
      console.log(JSON.stringify({ at: lib.nowIso(), stale, changes: prev ? diff(prev, snap) : null }, null, 2));
    } else if (stale.length) {
      console.log(`${lib.nowIso()} STALE (${stale.length}):`);
      for (const s of stale) console.log(`- ${s.id}: ${s.reasons.join("; ")}`);
    } else {
      console.log(`${lib.nowIso()} no stale claims (${snap.size} claims tracked)`);
    }
    return { snap, staleCount: stale.length };
  };

  if (!args.watch) {
    const { staleCount } = check(null);
    process.exit(staleCount ? 1 : 0);
  }

  let prev = null;
  const tick = () => {
    const { snap } = check(prev);
    if (prev) {
      const changes = diff(prev, snap);
      for (const c of changes) console.log(`${lib.nowIso()} TRANSITION ${c.id}: ${c.from} -> ${c.to}${c.reasons.length ? ` (${c.reasons.join("; ")})` : ""}`);
    }
    prev = snap;
    setTimeout(tick, Math.max(5, args.watch) * 1000);
  };
  tick();
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
