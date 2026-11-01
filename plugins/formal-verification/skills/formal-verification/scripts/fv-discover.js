// fv-discover: adapter-based system discovery (MASTER-SPEC Stage 2).
//
// Extracts an inventory — entry points, datastores, actors, boundaries — from
// repository artifacts. Adapters are deliberately shallow and honest: they
// report what the artifacts declare, mark inference as inference, and never
// claim runtime truth. Output feeds Stage 3 (threat analysis) and fv-claims.
//
// Adapters:
//   --openapi <spec.json|yaml-ish>   operations, security schemes, servers
//   --sql <dir|file>                 CREATE TABLE / INDEX / constraint scan
//   --routes <dir>                   HTTP handler registrations in Go/JS/TS/Py source
//   (at least one adapter is required; combine freely)
//
// Output: .formal-verification/discovery/inventory.json (+ console summary),
// including a Stage-3 scaffold: per-surface six-question threat prompts with
// choke candidates pre-mapped to catalog claims. The scaffold is a worksheet,
// not an analysis — humans/agent must answer it.
//
// Exit: 0 inventory written, 1 adapter found nothing (reported, not a pass), 2 usage/setup.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

function parseArgs(argv) {
  const a = { openapi: [], sql: [], routes: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--repo") a.repo = next();
    else if (t === "--openapi") a.openapi.push(next());
    else if (t === "--sql") a.sql.push(next());
    else if (t === "--routes") a.routes.push(next());
    else if (t === "--out") a.out = next();
    else throw new Error(`unknown argument: ${t}`);
  }
  return a;
}

function readText(p) { return fs.readFileSync(p, "utf8"); }

function collectFiles(target, exts) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return [];
  const st = fs.statSync(abs);
  if (st.isFile()) return exts.some((e) => abs.endsWith(e)) ? [abs] : [];
  const out = [];
  const skip = new Set(["node_modules", ".git", "vendor", ".formal-verification", "dist", "build"]);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(f);
    }
  };
  walk(abs);
  return out;
}

// ---------------------------------------------------------------- OpenAPI
// JSON parses directly. YAML input is handled with a deliberately minimal
// indentation scanner for the subset discovery needs (paths/operations/
// security); anything it cannot read is reported, not guessed.
function discoverOpenApi(file) {
  const text = readText(file);
  const inv = { source: file, kind: "openapi", operations: [], securitySchemes: [], servers: [], notes: [] };
  let doc = null;
  try { doc = JSON.parse(text); } catch { doc = null; }
  if (doc && doc.paths) {
    inv.format = doc.openapi || doc.swagger || "json";
    for (const [p, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops || {})) {
        if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) continue;
        inv.operations.push({
          method: method.toUpperCase(), path: p,
          operationId: (op && op.operationId) || null,
          secured: Array.isArray(op && op.security) ? op.security.length > 0 : null,
          tags: (op && op.tags) || [],
        });
      }
    }
    const schemes = doc.components && doc.components.securitySchemes;
    if (schemes) for (const [name, s] of Object.entries(schemes)) inv.securitySchemes.push({ name, type: s.type || null, scheme: s.scheme || null });
    if (Array.isArray(doc.servers)) inv.servers = doc.servers.map((s) => s.url);
    return inv;
  }
  // Minimal YAML fallback: path lines at 2-space indent under `paths:`, ops at 4.
  const lines = text.split("\n");
  let inPaths = false;
  let currentPath = null;
  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line)) inPaths = false;
    if (!inPaths) continue;
    const pm = line.match(/^ {2}(\/\S*):\s*$/);
    if (pm) { currentPath = pm[1]; continue; }
    const om = line.match(/^ {4}(get|post|put|patch|delete|head|options):\s*$/);
    if (om && currentPath) inv.operations.push({ method: om[1].toUpperCase(), path: currentPath, operationId: null, secured: null, tags: [], inferred: "yaml-lite" });
  }
  inv.format = "yaml-lite";
  inv.notes.push("YAML parsed with the lite scanner (paths + operations only); security schemes and details require the JSON form or manual review.");
  return inv;
}

// ---------------------------------------------------------------- SQL DDL
function discoverSql(files) {
  const inv = { kind: "sql", tables: [], files: files.length };
  for (const f of files) {
    const text = readText(f).replace(/--.*$/gm, "");
    for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"[]?([A-Za-z0-9_]+)/gi)) {
      inv.tables.push({ name: m[1], file: path.basename(f) });
    }
    for (const m of text.matchAll(/create\s+(unique\s+)?index\s+[`"[]?([A-Za-z0-9_]+)/gi)) {
      inv.tables.push({ name: `(index) ${m[2]}`, file: path.basename(f) });
    }
  }
  const seen = new Set();
  inv.tables = inv.tables.filter((t) => { const k = `${t.name}@${t.file}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return inv;
}

// ---------------------------------------------------------------- routes in code
const ROUTE_PATTERNS = [
  { stack: "express-like", re: /\b(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { stack: "go-http", re: /\bHandleFunc\s*\(\s*"([^"]+)"/g },
  { stack: "go-chi-gin", re: /\b\w+\.(GET|POST|PUT|PATCH|DELETE)\s*\(\s*"([^"]+)"/g },
  { stack: "fastapi-flask", re: /@\w+\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g },
  { stack: "pocketbase-like", re: /\brouterAdd\s*\(|apis\.static|bindRecordAPIs|recordAPI/g },
];

function discoverRoutes(dirs) {
  const files = dirs.flatMap((d) => collectFiles(d, [".go", ".js", ".ts", ".py", ".mjs", ".cjs"]));
  const routes = [];
  for (const f of files) {
    const text = readText(f);
    for (const { stack, re } of ROUTE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (stack === "pocketbase-like") continue; // marker only, counted below
        routes.push({ stack, method: (m[1] || "ANY").toUpperCase(), path: m[2], file: path.basename(f) });
      }
    }
    if (ROUTE_PATTERNS[4].re.test(text)) {
      routes.push({ stack: "pocketbase-like", method: "FRAMEWORK", path: "(record APIs bound by framework; enumerate collections from migrations/OpenAPI)", file: path.basename(f) });
    }
  }
  return { kind: "routes", filesScanned: files.length, routes };
}

// ---------------------------------------------------------------- scaffold
const SURFACE_CLAIMS = [
  { match: /(login|token|auth|session|password|otp|mfa)/i, claims: ["CLM-AUTHZ-002", "CLM-AUTHZ-003", "CLM-AUTHZ-011", "CLM-AUTHZ-010"] },
  { match: /(admin|settings|config|operator|superuser)/i, claims: ["CLM-AUTHZ-005", "CLM-AUTHZ-008"] },
  { match: /(sql|query|console)/i, claims: ["CLM-AUTHZ-008"] },
  { match: /(sync|replicat|realtime|subscribe|events)/i, claims: ["CLM-NET-003", "CLM-NET-004", "CLM-NET-006", "CLM-ISO-002"] },
  { match: /(file|upload|download|thumb|export|backup)/i, claims: ["CLM-PLAT-001", "CLM-PLAT-002", "CLM-ISO-005", "CLM-INT-005"] },
  { match: /(\{[^}]*(id|Id)[^}]*\}|\/:\w+)/, claims: ["CLM-AUTHZ-004", "CLM-ISO-001", "CLM-ISO-004"] },
  { match: /(search|vector|index)/i, claims: ["CLM-ISO-003", "CLM-AUTHZ-007"] },
];

function scaffold(operations) {
  return operations.map((op) => {
    const hay = `${op.method} ${op.path} ${op.operationId || ""}`;
    const claims = new Set(["CLM-AUTHZ-001"]);
    for (const sc of SURFACE_CLAIMS) if (sc.match.test(hay)) for (const c of sc.claims) claims.add(c);
    return {
      surface: `${op.method} ${op.path}`,
      questions: {
        harm: "what intolerable outcome is reachable through this surface?",
        adversary: "which classes (A0-A6) attempt it, with what credentials?",
        choke: "which single control must hold (name the code symbol)?",
        tripwire: "which claim + invariant + probe proves the choke held?",
        residuals: "what remains uncovered (timing, covert channels, TCB)?",
      },
      candidateClaims: [...claims],
      status: "UNANSWERED — discovery never answers for you",
    };
  });
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const startedAt = lib.nowIso();

  if (!args.openapi.length && !args.sql.length && !args.routes.length) {
    console.error("fv-discover: at least one adapter is required (--openapi | --sql | --routes)");
    process.exit(2);
  }

  const sections = [];
  const allOps = [];
  for (const f of args.openapi) {
    const inv = discoverOpenApi(path.resolve(f));
    sections.push(inv);
    for (const op of inv.operations) allOps.push(op);
  }
  if (args.sql.length) {
    const files = args.sql.flatMap((t) => collectFiles(t, [".sql"]));
    sections.push(discoverSql(files));
  }
  if (args.routes.length) {
    const r = discoverRoutes(args.routes);
    sections.push(r);
    for (const op of r.routes) if (op.method !== "FRAMEWORK") allOps.push(op);
  }

  const opCount = allOps.length;
  const inventory = {
    tool: "formal-verification/fv-discover",
    formatVersion: 2,
    startedAt, finishedAt: lib.nowIso(),
    repo, gitCommit: lib.gitCommit(repo),
    sections,
    summary: {
      operations: opCount,
      openApiSpecs: sections.filter((s) => s.kind === "openapi").length,
      tables: sections.filter((s) => s.kind === "sql").reduce((n, s) => n + s.tables.length, 0),
      routeFiles: sections.filter((s) => s.kind === "routes").reduce((n, s) => n + s.filesScanned, 0),
    },
    threatScaffold: scaffold(allOps),
    honesty: "Discovery reports what artifacts declare (lite-YAML and regex routes are inference, labeled as such). It finds surfaces; it proves nothing about them. An empty inventory is reported as such, never as 'no surface'.",
  };

  const out = args.out ? path.resolve(args.out) : path.join(repo, ".formal-verification", "discovery", "inventory.json");
  lib.writeJson(out, inventory);
  console.log(JSON.stringify({
    out,
    summary: inventory.summary,
    surfaces: allOps.slice(0, 20).map((o) => `${o.method} ${o.path}`),
    moreSurfaces: Math.max(0, opCount - 20),
  }, null, 2));
  // Exit 1 only when NOTHING was found across every adapter. A scan that
  // read files but matched no route patterns is a valid (honest) inventory:
  // surfaces: [] says so, rather than exit code pretending otherwise.
  const foundAnything = opCount > 0 || inventory.summary.tables > 0 || inventory.summary.routeFiles > 0;
  process.exit(foundAnything ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
