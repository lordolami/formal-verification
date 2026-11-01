// Probe demo target — deliberately two-faced.
// FV_DEMO_MODE=secure   -> correct authorization (probes must PASS)
// FV_DEMO_MODE=insecure -> BOLA + mass-assignment bugs (probes must FAIL;
//                          fv-qualify uses this as a positive detection case)
// Implements just enough PocketBase-shaped API for the shipped probe set.
// Node >= 20, no dependencies. Synthetic data only.
const http = require("node:http");

const mode = process.env.FV_DEMO_MODE || "secure";
const port = Number(process.env.FV_DEMO_PORT || 0);

const items = new Map([
  ["recAlice000000001", { id: "recAlice000000001", title: "alice doc", owner: "alice" }],
  ["recBob00000000001", { id: "recBob00000000001", title: "bob doc", owner: "bob" }],
]);
const tokens = { aliceTok: "alice", bobTok: "bob" };

function actor(req) {
  const h = req.headers.authorization || "";
  const t = h.replace(/^Bearer /, "");
  return tokens[t] || null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const me = actor(req);
  const m = url.pathname.match(/^\/api\/collections\/items\/records(?:\/([^/]+))?$/);
  if (!m) return send(404, { code: 404, message: "not found" });

  if (req.method === "GET" && !m[1]) {
    if (!me) return send(401, { code: 401, message: "unauthorized" });
    return send(200, { items: [...items.values()].filter((i) => mode === "insecure" || i.owner === me) });
  }
  if (req.method === "GET" && m[1]) {
    if (!me) return send(401, { code: 401, message: "unauthorized" });
    const it = items.get(m[1]);
    if (!it) return send(404, { code: 404, message: "not found" });
    if (mode === "secure" && it.owner !== me) return send(404, { code: 404, message: "not found" });
    return send(200, it);
  }
  if (req.method === "POST" && !m[1]) {
    if (!me) return send(401, { code: 401, message: "unauthorized" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      if (mode === "insecure") {
        const rec = { id: `rec${Date.now()}`, ...data, owner: data.owner || me };
        items.set(rec.id, rec);
        return send(200, rec);
      }
      const rec = { id: `rec${Date.now()}`, title: String(data.title || ""), owner: me };
      items.set(rec.id, rec);
      return send(200, rec);
    });
    return;
  }
  return send(405, { code: 405, message: "method not allowed" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ demo: "probe-target", mode, port: server.address().port }));
});
