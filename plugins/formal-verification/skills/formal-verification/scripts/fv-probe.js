// fv-probe: execute claim-linked HTTP security probes against a live backend
// and emit evidence in the same format discipline as fv-run (formatVersion 2).
//
// Probes are the implementation-level dual of the Quint models: BOLA swaps,
// anonymous-surface checks, mass-assignment injection, existence-oracle
// comparison. Every probe names the claim it executes (probe sets ship with
// claim ids). Expectations are explicit: deny (401/403/404), allow (2xx), or
// denyOrStrip (privileged fields absent from the response echo).
//
// Safety: mutating probes (anything non-GET or with a body) require
// --allow-mutating. Base URL must come from --base or FV_PROBE_BASE and may
// be pinned with --pin-host. Synthetic titles carry the fv-probe- prefix.
// Tokens come from environment variables named in the probe set — this
// script never prints token values.
//
// Usage:
//   FV_PROBE_ALICE_TOKEN=... FV_PROBE_BOB_TOKEN=... \
//   FV_PROBE_ALICE_OBJECT_ID=... FV_PROBE_BOB_OBJECT_ID=... \
//   node fv-probe.js --probes <set.json> --base http://127.0.0.1:8090 \
//                    [--allow-mutating] [--pin-host 127.0.0.1] [--repo <dir>] [--out <evidence.json>]
// Exit: 0 all probes behaved as claimed, 1 any violation, 2 setup error.

const lib = require("./lib/fv-lib");
const { fs, path, os } = lib;

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    if (t === "--probes") a.probes = next();
    else if (t === "--base") a.base = next();
    else if (t === "--repo") a.repo = next();
    else if (t === "--out") a.out = next();
    else if (t === "--pin-host") a.pinHost = next();
    else if (t === "--allow-mutating") a.allowMutating = true;
    else if (t === "--timeout-ms") a.timeoutMs = Number(next());
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!a.probes) throw new Error("missing --probes <set.json>");
  return a;
}

function expand(template, vars) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

async function httpRequest(base, method, urlPath, { token, json, timeoutMs }) {
  const url = new URL(urlPath, base);
  const headers = { "x-fv-probe": "formal-verification" };
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  const started = Date.now();
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { status: res.status, ms: Date.now() - started, bodyText: text.slice(0, 4000) };
}

function errorClass(status) {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 400 && status < 500) return `client-${status}`;
  if (status >= 500) return "server-error";
  return "success";
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo ? path.resolve(args.repo) : process.cwd();
  const startedAt = lib.nowIso();
  const timeoutMs = args.timeoutMs || 15000;

  const set = JSON.parse(fs.readFileSync(path.resolve(args.probes), "utf8"));
  const base = args.base || process.env.FV_PROBE_BASE;
  if (!base) throw new Error("missing base URL: pass --base or set FV_PROBE_BASE");

  const baseUrl = new URL(base);
  if (args.pinHost && baseUrl.hostname !== args.pinHost) {
    throw new Error(`base host ${baseUrl.hostname} does not match pinned host ${args.pinHost}; refusing to probe an unpinned target`);
  }

  // Resolve actors from environment (values never logged).
  const actorTokens = {};
  const vars = {};
  for (const [name, def] of Object.entries(set.actors || {})) {
    actorTokens[name] = def.tokenEnv ? process.env[def.tokenEnv] || null : null;
    if (def.objectEnv && process.env[def.objectEnv]) vars[`${name}ObjectId`] = process.env[def.objectEnv];
  }
  vars.aliceObjectId = vars.aliceObjectId || process.env.FV_PROBE_ALICE_OBJECT_ID || "";
  vars.bobObjectId = vars.bobObjectId || process.env.FV_PROBE_BOB_OBJECT_ID || "";

  return run();

  async function run() {
    const results = [];
    for (const probe of set.probes || []) {
      results.push(await execute(probe));
    }
    const violations = results.filter((r) => r.outcome === "violation");
    const errors = results.filter((r) => r.outcome === "error");
    const verdict = violations.length || errors.length ? "FAIL" : "PASS";
    const record = {
      tool: "formal-verification/fv-probe",
      formatVersion: 2,
      target: baseUrl.origin,
      probeSet: path.resolve(args.probes),
      probeSetSha256: lib.sha256File(path.resolve(args.probes)),
      startedAt,
      finishedAt: lib.nowIso(),
      quintExpected: null,
      quintActual: null,
      setupError: null,
      provenance: {
        gitCommit: lib.gitCommit(repo),
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        allowMutating: !!args.allowMutating,
        note: "Probe verdicts concern the live target at the recorded time only; PASS means every executed probe behaved as its claim requires — not that the system is secure.",
      },
      gates: [{
        gate: "probes",
        ok: verdict === "PASS",
        status: verdict === "PASS" ? "passed" : "failed",
        detail: results.map((r) => ({ id: r.id, claim: r.claim, outcome: r.outcome, detail: r.detail })),
      }],
      probes: results,
      verdict,
    };
    const out = args.out || path.join(repo, ".formal-verification", "evidence", `probe-${stamp()}.json`);
    lib.writeJson(out, record);
    console.log(JSON.stringify({
      verdict, out,
      probes: results.map((r) => `${r.id}:${r.outcome}`),
      violations: violations.map((v) => ({ id: v.id, claim: v.claim, detail: v.detail })),
    }, null, 2));
    process.exit(verdict === "PASS" ? 0 : 1);
  }

  async function execute(probe) {
    const baseRec = { id: probe.id, claim: probe.claim || null, title: probe.title || "" };
    try {
      if (probe.oracle) return await executeOracle(probe, baseRec);
      const method = (probe.method || "GET").toUpperCase();
      const mutating = method !== "GET" || probe.json !== undefined;
      if (mutating && !args.allowMutating) {
        return { ...baseRec, outcome: "error", detail: "mutating probe requires --allow-mutating (safety law, SECURITY.md §5)" };
      }
      const token = probe.actor && probe.actor !== "anonymous" ? actorTokens[probe.actor] : null;
      if (probe.actor && probe.actor !== "anonymous" && !token) {
        return { ...baseRec, outcome: "error", detail: `actor ${probe.actor} token env not set; probe not executed` };
      }
      const url = expand(probe.url, vars);
      const json = probe.json ? JSON.parse(expand(JSON.stringify(probe.json), vars)) : undefined;
      const r = await httpRequest(base, method, url, { token, json, timeoutMs });
      return judge(probe, baseRec, r, json);
    } catch (e) {
      return { ...baseRec, outcome: "error", detail: `probe execution error: ${e.message}` };
    }
  }

  async function executeOracle(probe, baseRec) {
    const sides = {};
    for (const side of ["a", "b"]) {
      const spec = probe.oracle[side];
      const token = spec.actor && spec.actor !== "anonymous" ? actorTokens[spec.actor] : null;
      if (spec.actor && spec.actor !== "anonymous" && !token) {
        return { ...baseRec, outcome: "error", detail: `oracle actor ${spec.actor} token env not set` };
      }
      sides[side] = await httpRequest(base, (spec.method || "GET").toUpperCase(), expand(spec.url, vars), { token, timeoutMs });
    }
    const ca = errorClass(sides.a.status);
    const cb = errorClass(sides.b.status);
    const same = ca === cb;
    const ok = probe.expect && probe.expect.sameErrorClass ? same : !same;
    return {
      ...baseRec,
      outcome: ok ? "as-claimed" : "violation",
      detail: `foreign-existent => ${sides.a.status} (${ca}); nonexistent => ${sides.b.status} (${cb}); error classes ${same ? "match" : "DIFFER — existence oracle leaks"}`,
      observed: { a: sides.a.status, b: sides.b.status },
    };
  }

  function judge(probe, baseRec, r, sentJson) {
    const exp = probe.expect || {};
    const denied = r.status === 401 || r.status === 403 || r.status === 404;
    const allowed = r.status >= 200 && r.status < 300;
    if (exp.deny) {
      return { ...baseRec, outcome: denied ? "as-claimed" : "violation", detail: `expected deny (401/403/404), observed ${r.status}`, observed: { status: r.status } };
    }
    if (exp.allow) {
      return { ...baseRec, outcome: allowed ? "as-claimed" : "violation", detail: `expected allow (2xx), observed ${r.status}`, observed: { status: r.status } };
    }
    if (Array.isArray(exp.denyOrStrip)) {
      if (denied) return { ...baseRec, outcome: "as-claimed", detail: `request denied (${r.status}); injection refused outright`, observed: { status: r.status } };
      if (!allowed) return { ...baseRec, outcome: "violation", detail: `expected deny-or-strip, observed ${r.status}`, observed: { status: r.status } };
      // Violation = the server HONORED the injected value (echoed back the
      // attacker-supplied value). Server-set fields with server-chosen values
      // (e.g. owner stamped from the session) are correct behavior, not
      // mass assignment. Unparseable body: cannot confirm; count fields.
      let honored = [];
      let unconfirmable = [];
      try {
        const parsed = JSON.parse(r.bodyText);
        const rec = parsed && typeof parsed === "object" ? parsed : {};
        for (const f of exp.denyOrStrip) {
          if (!sentJson || !Object.prototype.hasOwnProperty.call(sentJson, f)) continue;
          if (Object.prototype.hasOwnProperty.call(rec, f)) {
            if (String(rec[f]) === String(sentJson[f])) honored.push(f);
            // present with a different (server-chosen) value: stripped/overridden — fine
          }
        }
      } catch { unconfirmable = exp.denyOrStrip.slice(); }
      const bad = honored.length ? honored : unconfirmable;
      return {
        ...baseRec,
        outcome: bad.length ? "violation" : "as-claimed",
        detail: honored.length
          ? `injected privileged values honored by server: ${honored.join(", ")}`
          : unconfirmable.length
            ? "response body unparseable; cannot confirm injected values were stripped"
            : "injected privileged values stripped or overridden by server",
        observed: { status: r.status },
      };
    }
    return { ...baseRec, outcome: "error", detail: "probe has no recognizable expectation (deny | allow | denyOrStrip)" };
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  }
}

try {
  Promise.resolve(main()).catch((e) => {
    console.error(`formal-verification error: ${e.message}`);
    process.exit(2);
  });
} catch (e) {
  console.error(`formal-verification error: ${e.message}`);
  process.exit(2);
}
