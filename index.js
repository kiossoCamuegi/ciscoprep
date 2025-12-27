"use strict";

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

// -------------------- CONFIG --------------------
const PORT = process.env.PORT || 4000;
const IS_VERCEL = !!process.env.VERCEL;

const DB = {
  host: process.env.MYSQL_HOST || "cpanel154.dnscpanel.com",
  user: process.env.MYSQL_USER || "eduallsi_cisco",
  password: process.env.MYSQL_PASSWORD || "@0i@~G@e&hVKFrV&",
  database: process.env.MYSQL_DATABASE || "eduallsi_cisco",
  connectionLimit: 10,

  // Timeouts importantes para serverless
  connectTimeout: 8000,     // conexão TCP
  acquireTimeout: 8000,     // pegar conexão do pool
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

const CISCO_LOGO =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Cisco_logo.svg/1200px-Cisco_logo.svg.png";

// -------------------- DB POOL --------------------
const pool = mysql.createPool({
  host: DB.host,
  user: DB.user,
  password: DB.password,
  database: DB.database,
  waitForConnections: true,
  connectionLimit: DB.connectionLimit,
  namedPlaceholders: true,
   port: 3306,

  connectTimeout: DB.connectTimeout,
  acquireTimeout: DB.acquireTimeout,
  enableKeepAlive: DB.enableKeepAlive,
  keepAliveInitialDelay: DB.keepAliveInitialDelay
});

// -------------------- APP --------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// -------------------- SMALL UTILS --------------------
function badRequest(res, msg) {
  return res.status(400).json({ ok: false, error: msg });
}
function notFound(res, msg = "Not found") {
  return res.status(404).json({ ok: false, error: msg });
}
function isValidStatus(s) {
  return ["todo", "doing", "done"].includes(s);
}
function isValidPriority(p) {
  return ["P1", "P2", "P3"].includes(p);
}
function toInt(x, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}
function safeErrMsg(e) {
  const msg = String(e?.message || "Unexpected error");
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// -------------------- DB CHECK (falha rápido -> 503) --------------------
async function dbPing() {
  // Faz ping rápido. Se demorar, falha e devolve 503.
  await withTimeout(pool.query("SELECT 1"), 8000, "db_ping_timeout");
}

// -------------------- API GUARD (não quebra página) --------------------
app.use(
  "/api",
  asyncRoute(async (req, res, next) => {
    try {
      await dbPing();
      return next();
    } catch (e) {
      // MUITO importante: responder rápido para não virar 504
      return res.status(503).json({
        ok: false,
        error:
          "Base de dados indisponível (ou bloqueada a partir do Vercel). Tenta novamente.",
        hint:
          "Se isto só acontece no Vercel, o MySQL pode estar a bloquear ligações remotas/porta 3306.",
      });
    }
  })
);

// -------------------- API --------------------
app.get(
  "/api/health",
  asyncRoute(async (req, res) => {
    try {
      await dbPing();
      res.json({ ok: true, db: "ok" });
    } catch (e) {
      res.status(503).json({ ok: false, db: "down", error: "DB not reachable" });
    }
  })
);

/**
 * GET /api/board?q=...
 */
app.get(
  "/api/board",
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();

    // getConnection com timeout (evita pendurar -> 504)
    const conn = await withTimeout(pool.getConnection(), 8000, "db_getConnection_timeout");
    try {
      const [groups] = await withTimeout(
        conn.query(
          "SELECT id, title, position, collapsed, created_at, updated_at FROM `groups` ORDER BY position ASC, id ASC"
        ),
        8000,
        "db_query_timeout_groups"
      );

      let itemsSql =
        "SELECT id, group_id, title, status, priority, due_date, notes, position, created_at, updated_at " +
        "FROM `items` ";
      const params = {};

      if (q) {
        itemsSql +=
          "WHERE LOWER(title) LIKE :q OR LOWER(IFNULL(notes,'')) LIKE :q OR LOWER(status) LIKE :q OR LOWER(priority) LIKE :q ";
        params.q = `%${q}%`;
      }
      itemsSql += "ORDER BY group_id ASC, position ASC, id ASC";

      const [items] = await withTimeout(
        conn.query(itemsSql, params),
        8000,
        "db_query_timeout_items"
      );

      const map = new Map();
      for (const g of groups) map.set(g.id, { ...g, items: [] });
      for (const it of items) {
        const g = map.get(it.group_id);
        if (g) g.items.push(it);
      }

      const result = [...map.values()].filter((g) => !q || g.items.length > 0);
      res.json({ ok: true, groups: result });
    } finally {
      conn.release();
    }
  })
);

/**
 * POST /api/groups { title }
 */
app.post(
  "/api/groups",
  asyncRoute(async (req, res) => {
    const title = String(req.body?.title || "").trim();
    if (!title) return badRequest(res, "title is required");

    const conn = await withTimeout(pool.getConnection(), 8000, "db_getConnection_timeout");
    try {
      const [[maxRow]] = await withTimeout(
        conn.query("SELECT COALESCE(MAX(position), 0) AS maxPos FROM `groups`"),
        8000,
        "db_query_timeout"
      );

      const position = (maxRow?.maxPos ?? 0) + 1;

      const [r] = await withTimeout(
        conn.query(
          "INSERT INTO `groups` (title, position, collapsed) VALUES (:title, :position, 0)",
          { title, position }
        ),
        8000,
        "db_query_timeout"
      );

      const [rows] = await withTimeout(
        conn.query(
          "SELECT id, title, position, collapsed, created_at, updated_at FROM `groups` WHERE id = :id",
          { id: r.insertId }
        ),
        8000,
        "db_query_timeout"
      );

      res.status(201).json({ ok: true, group: rows[0] });
    } finally {
      conn.release();
    }
  })
);

/**
 * PATCH /api/groups/:id { title?, collapsed?, position? }
 */
app.patch(
  "/api/groups/:id",
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) return badRequest(res, "invalid id");

    const fields = [];
    const params = { id };

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return badRequest(res, "title cannot be empty");
      fields.push("title = :title");
      params.title = title;
    }
    if (req.body?.collapsed !== undefined) {
      fields.push("collapsed = :collapsed");
      params.collapsed = req.body.collapsed ? 1 : 0;
    }
    if (req.body?.position !== undefined) {
      fields.push("position = :position");
      params.position = toInt(req.body.position, 0);
    }

    if (fields.length === 0) return badRequest(res, "no fields to update");

    const conn = await withTimeout(pool.getConnection(), 8000, "db_getConnection_timeout");
    try {
      const [u] = await withTimeout(
        conn.query(`UPDATE \`groups\` SET ${fields.join(", ")} WHERE id = :id`, params),
        8000,
        "db_query_timeout"
      );
      if (u.affectedRows === 0) return notFound(res, "group not found");

      const [rows] = await withTimeout(
        conn.query(
          "SELECT id, title, position, collapsed, created_at, updated_at FROM `groups` WHERE id = :id",
          { id }
        ),
        8000,
        "db_query_timeout"
      );

      res.json({ ok: true, group: rows[0] });
    } finally {
      conn.release();
    }
  })
);

/**
 * DELETE /api/groups/:id
 */
app.delete(
  "/api/groups/:id",
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) return badRequest(res, "invalid id");

    const conn = await withTimeout(pool.getConnection(), 8000, "db_getConnection_timeout");
    try {
      const [d] = await withTimeout(
        conn.query("DELETE FROM `groups` WHERE id = :id", { id }),
        8000,
        "db_query_timeout"
      );
      if (d.affectedRows === 0) return notFound(res, "group not found");
      res.json({ ok: true });
    } finally {
      conn.release();
    }
  })
);

/**
 * POST /api/groups/:groupId/items
 */
app.post(
  "/api/groups/:groupId/items",
  asyncRoute(async (req, res) => {
    const groupId = toInt(req.params.groupId);
    if (!groupId) return badRequest(res, "invalid groupId");

    const title = String(req.body?.title || "").trim();
    if (!title) return badRequest(res, "title is required");

    const status = String(req.body?.status || "todo");
    const priority = String(req.body?.priority || "P3");
    const due_date = req.body?.due_date ? String(req.body.due_date) : null;
    const notes = req.body?.notes ? String(req.body.notes) : null;

    if (!isValidStatus(status)) return badRequest(res, "invalid status");
    if (!isValidPriority(priority)) return badRequest(res, "invalid priority");

    const conn = await withTimeout(pool.getConnection(), 8000, "db_getConnection_timeout");
    try {
      const [g] = await withTimeout(
        conn.query("SELECT id FROM `groups` WHERE id = :id", { id: groupId }),
        8000,
        "db_query_timeout"
      );
      if (g.length === 0) return notFound(res, "group not found");

      const [[maxRow]] = await withTimeout(
        conn.query(
          "SELECT COALESCE(MAX(position), 0) AS maxPos FROM `items` WHERE group_id = :groupId",
          { groupId }
        ),
        8000,
        "db_query_timeout"
      );

      const position = (maxRow?.maxPos ?? 0) + 1;

      const [r] = await withTimeout(
        conn.query(
          "INSERT INTO `items` (group_id, title, status, priority, due_date, notes, position) " +
            "VALUES (:group_id, :title, :status, :priority, :due_date, :notes, :position)",
          { group_id: groupId, title, status, priority, due_date, notes, position }
        ),
        8000,
        "db_query_timeout"
      );

      const [rows] = await withTimeout(
        conn.query(
          "SELECT id, group_id, title, status, priority, due_date, notes, position, created_at, updated_at FROM `items` WHERE id = :id",
          { id: r.insertId }
        ),
        8000,
        "db_query_timeout"
      );

      res.status(201).json({ ok: true, item: rows[0] });
    } finally {
      conn.release();
    }
  })
);

/**
 * PATCH /api/items/:id
 */
app.patch(
  "/api/items/:id",
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) return badRequest(res, "invalid id");

    const fields = [];
    const params = { id };

    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return badRequest(res, "title cannot be empty");
      fields.push("title = :title");
      params.title = title;
    }
    if (req.body?.status !== undefined) {
      const status = String(req.body.status);
      if (!isValidStatus(status)) return badRequest(res, "invalid status");
      fields.push("status = :status");
      params.status = status;
    }
    if (req.body?.priority !== undefined) {
      const priority = String(req.body.priority);
      if (!isValidPriority(priority)) return badRequest(res, "invalid priority");
      fields.push("priority = :priority");
      params.priority = priority;
    }
    if (req.body?.due_date !== undefined) {
      fields.push("due_date = :due_date");
      params.due_date = req.body.due_date ? String(req.body.due_date) : null;
    }
    if (req.body?.notes !== undefined) {
      fields.push("notes = :notes");
      params.notes = req.body.notes ? String(req.body.notes) : null;
    }
    if (req.body?.position !== undefined) {
      fields.push("position = :position");
      params.position = toInt(req.body.position, 0);
    }
    if (req.body?.group_id !== undefined) {
      const group_id = toInt(req.body.group_id);
      if (!group_id) return badRequest(res, "invalid group_id");
      fields.push("group_id = :group_id");
      params.group_id = group_id;
    }

    if (fields.length === 0) return badRequest(res, "no fields to update");

    const conn = await withTimeout(pool.getConnection(), 8000, "db_getConnection_timeout");
    try {
      const [u] = await withTimeout(
        conn.query(`UPDATE \`items\` SET ${fields.join(", ")} WHERE id = :id`, params),
        8000,
        "db_query_timeout"
      );
      if (u.affectedRows === 0) return notFound(res, "item not found");

      const [rows] = await withTimeout(
        conn.query(
          "SELECT id, group_id, title, status, priority, due_date, notes, position, created_at, updated_at FROM `items` WHERE id = :id",
          { id }
        ),
        8000,
        "db_query_timeout"
      );

      res.json({ ok: true, item: rows[0] });
    } finally {
      conn.release();
    }
  })
);

/**
 * DELETE /api/items/:id
 */
app.delete(
  "/api/items/:id",
  asyncRoute(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) return badRequest(res, "invalid id");

    const conn = await withTimeout(pool.getConnection(), 8000, "db_getConnection_timeout");
    try {
      const [d] = await withTimeout(
        conn.query("DELETE FROM `items` WHERE id = :id", { id }),
        8000,
        "db_query_timeout"
      );
      if (d.affectedRows === 0) return notFound(res, "item not found");
      res.json({ ok: true });
    } finally {
      conn.release();
    }
  })
);

// -------------------- FRONTEND (HTML SEMPRE) --------------------
app.get(
  "/",
  asyncRoute(async (req, res) => {
    // Não tenta “forçar” DB no / para não travar o HTML.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(INDEX_HTML(""));
  })
);

// -------------------- GLOBAL ERROR HANDLER --------------------
app.use((err, req, res, next) => {
  console.error("Unhandled route error:", safeErrMsg(err));

  if (req.path.startsWith("/api")) {
    return res.status(500).json({ ok: false, error: "Erro interno no servidor." });
  }

  res
    .status(500)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send(INDEX_HTML("Erro interno no servidor. Recarrega a página."));
});

// -------------------- PROCESS SAFETY --------------------
process.on("unhandledRejection", (reason) => console.error("UnhandledRejection:", safeErrMsg(reason)));
process.on("uncaughtException", (err) => console.error("UncaughtException:", safeErrMsg(err)));

// -------------------- SERVERLESS EXPORT (Vercel) --------------------
module.exports = (req, res) => app(req, res);

// -------------------- LOCAL START --------------------
if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
  });
}

// -------------------- HTML TEMPLATE --------------------
function INDEX_HTML(bootErrorMsg) {
  const bootError = String(bootErrorMsg || "");

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Software Engineer Grade 6 — Cisco Study Board</title>

  <link rel="icon" href="${CISCO_LOGO}">
  <link rel="apple-touch-icon" href="${CISCO_LOGO}">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">

  <style>
    :root{
      --bg1:#f7f9fc; --bg2:#eef3ff;
      --panel: rgba(255,255,255,.92);
      --text:#0f172a; --muted:#64748b;
      --border: rgba(15,23,42,.10);
      --shadow: 0 18px 60px rgba(15,23,42,.10);
      --radius: 18px; --radius2: 14px;
      --rowHover: rgba(37,99,235,.05);
      --rowSelect: rgba(37,99,235,.10);
      --green:#16a34a; --yellow:#f59e0b; --gray:#64748b;
      --focusRing: 0 0 0 .25rem rgba(37,99,235,.18);
    }
    body{ background: linear-gradient(180deg,var(--bg1),var(--bg2)); color:var(--text); min-height:100vh; }
    .shell{ max-width: 1900px; margin:0 auto; padding: 14px 14px 64px; }
    .panel{ background:var(--panel); backdrop-filter: blur(10px); border:1px solid var(--border); box-shadow:var(--shadow); border-radius:var(--radius); overflow:hidden; }
    .app-header{ display:flex; justify-content:space-between; align-items:center; gap:14px; padding:14px 16px; }
    .brand{ display:flex; align-items:center; gap:12px; min-width: 360px; }
    .cisco-logo{ height:34px; }
    .title{ font-weight:950; letter-spacing:-.02em; font-size:18px; line-height:1.1; }
    .subtitle{ color:var(--muted); font-size:12.5px; margin-top:2px; }

    .subbar{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px 14px; border-top:1px solid rgba(15,23,42,.06); background: rgba(255,255,255,.55); }
    .searchbox{ display:flex; align-items:center; gap:10px; width:100%; max-width:820px; padding:9px 12px; border:1px solid rgba(15,23,42,.10); background:rgba(255,255,255,.92); border-radius:999px; }
    .searchbox input{ border:none; outline:none; background:transparent; width:100%; font-size:14px; }
    .searchbox:focus-within{ box-shadow:var(--focusRing); border-color: rgba(37,99,235,.25); }

    .content{ padding:14px 16px 18px; }

    .error-banner{ border:1px solid rgba(239,68,68,.25); background: rgba(254,226,226,.75); border-radius:16px; padding:14px; margin-top:12px; display:none; }
    .error-banner.show{ display:block; }
    .error-title{ font-weight:950; color:#991b1b; }
    .error-desc{ color: rgba(127,29,29,.92); font-size:13px; margin-top:4px; }
    .error-meta{ color: rgba(127,29,29,.75); font-size:12px; margin-top:8px; }

    .group{ border:1px solid rgba(15,23,42,.08); border-radius:var(--radius2); overflow:hidden; background: rgba(255,255,255,.70); margin-top:12px; }
    .group-header{ display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 12px; background:rgba(255,255,255,.92); border-bottom:1px solid rgba(15,23,42,.06); }
    .group-title{ font-weight:950; }
    .group-meta{ color:var(--muted); font-size:12px; display:flex; gap:8px; margin-top:2px; flex-wrap:wrap; }

    .table-head, .rowx{ display:grid; grid-template-columns: 46px minmax(240px, 2.8fr) 1fr .9fr 1.2fr 1.7fr 120px; align-items:center; }
    .table-head{ padding:10px 12px; font-size:12px; color:var(--muted); background:rgba(15,23,42,.02); border-bottom:1px solid rgba(15,23,42,.06); }
    .rowx{ padding:10px 12px; border-bottom:1px solid rgba(15,23,42,.06); background:rgba(255,255,255,.80); transition:.12s; cursor:default; }
    .rowx:hover{ background: var(--rowHover); }
    .rowx.selected{ background: var(--rowSelect); }

    .cell{ padding-right:10px; min-width:0; }
    .item-title{ font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:14px; }
    .small-muted{ color:var(--muted); font-size:12px; margin-top:2px; }
    .strike{ text-decoration: line-through; color: rgba(100,116,139,.95); }

    .status-pill{ display:inline-flex; align-items:center; justify-content:center; padding:7px 10px; border-radius:999px; font-size:12px; font-weight:950; color:white; width:120px; user-select:none; }
    .status-todo{ background:var(--gray); } .status-doing{ background:var(--yellow); color:#1f2937; } .status-done{ background:var(--green); }

    .prio-pill{ display:inline-flex; align-items:center; justify-content:center; padding:7px 10px; border-radius:999px; font-size:12px; font-weight:950; border:1px solid rgba(15,23,42,.10); background: rgba(255,255,255,.90); width:74px; }
    .prio-P1{ color:#b91c1c; } .prio-P2{ color:#92400e; } .prio-P3{ color: rgba(15,23,42,.78); }

    .date-pill{ display:inline-flex; align-items:center; justify-content:center; padding:7px 10px; border-radius:999px; font-size:12px; font-weight:900; border:1px solid rgba(15,23,42,.10); background: rgba(255,255,255,.90); width:140px; }
    .notes{ color:var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    .row-actions{ display:flex; gap:8px; justify-content:flex-end; }
    .icon-btn{ width:40px; height:38px; border-radius:12px; border:1px solid rgba(15,23,42,.10); background: rgba(255,255,255,.92); display:flex; align-items:center; justify-content:center; font-weight:900; }
    .icon-btn:hover{ background: rgba(255,255,255,1); }

    .modal-content{ border-radius:18px; }
    .form-control, .form-select{ border-radius:14px; padding:10px 12px; }
    .form-control:focus, .form-select:focus{ box-shadow:var(--focusRing); border-color: rgba(37,99,235,.35); }
    .btn{ border-radius:12px; font-weight:800; }

    @media (max-width: 980px){
      .app-header{ flex-direction:column; align-items:stretch; gap:10px; }
      .brand{ min-width:unset; width:100%; }
      .app-header > .d-flex{ width:100%; justify-content:flex-start; }
      .subbar{ flex-direction:column; align-items:stretch; gap:10px; }
      .searchbox{ max-width:100%; width:100%; }
      .subbar .d-flex{ width:100%; justify-content:flex-start; }
      .subbar .btn{ flex:1; min-width:140px; }
    }
    @media (max-width: 860px){
      .group{ overflow-x:auto; }
      .table-head, .rowx{ min-width: 720px; }
      .hide-sm{ display:none !important; }
    }
    @media (max-width: 1080px){
      .hide-md{ display:none !important; }
      .table-head, .rowx{ grid-template-columns: 44px minmax(240px, 2.6fr) 1fr .9fr 1.2fr 120px; }
    }
  </style>
</head>

<body>
  <div class="shell">
    <div class="panel">
      <div class="app-header">
        <div class="brand">
          <img class="cisco-logo" alt="Cisco" src="${CISCO_LOGO}">
          <div>
            <div class="title">Software Engineer Grade 6 — Cisco Study Board</div>
            <div class="subtitle">Vercel-safe • timeouts • UI resiliente • sem 504 “pendurado”</div>
          </div>
        </div>

        <div class="d-flex gap-2 flex-wrap align-items-center">
          <span class="badge text-bg-light border" id="apiStatus">API: a verificar…</span>
          <button class="btn btn-outline-secondary btn-sm" id="btnReload">Recarregar</button>
        </div>
      </div>

      <div class="subbar">
        <div class="searchbox">
          <span class="text-muted">🔎</span>
          <input id="searchInput" placeholder="Pesquisar: title, notes, status, priority..." />
        </div>

        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-primary btn-sm" id="btnAddGroup">+ Novo grupo</button>
          <button class="btn btn-primary btn-sm" id="btnAddItem" disabled>+ Novo item</button>
          <button class="btn btn-outline-secondary btn-sm" id="btnEditItem" disabled>Editar</button>
          <button class="btn btn-outline-danger btn-sm" id="btnDeleteItem" disabled>Apagar</button>
        </div>
      </div>

      <div class="content">
        <div class="text-muted" style="font-size:12px;">
          Se o DB cair, a página não quebra • Mostra banner + retry (boa prática Grade 6)
        </div>

        <div id="errorBanner" class="error-banner">
          <div class="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div class="error-title" id="errorTitle">Sem ligação</div>
              <div class="error-desc" id="errorDesc">A API/DB não respondeu.</div>
              <div class="error-meta" id="errorMeta">Isto costuma ser firewall/remote MySQL bloqueado no hosting.</div>
            </div>
            <div class="d-flex gap-2 flex-wrap">
              <button class="btn btn-outline-danger btn-sm" id="btnRetry">Tentar novamente</button>
              <button class="btn btn-outline-secondary btn-sm" id="btnHideErr">Ocultar</button>
            </div>
          </div>
        </div>

        <div id="groupsWrap"></div>
      </div>
    </div>
  </div>

  <script>
    window.__BOOT_ERROR__ = ${JSON.stringify(bootError)};
  </script>

  <script src="https://cdn.jsdelivr.net/npm/axios@1.7.2/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

  <script>
    const API_BASE = "/api";
    const $ = (s) => document.querySelector(s);

    function showErrorBanner(title, desc, meta){
      $("#errorTitle").textContent = title || "Sem ligação";
      $("#errorDesc").textContent = desc || "A API/DB não respondeu.";
      $("#errorMeta").textContent = meta || "Tenta novamente.";
      $("#errorBanner").classList.add("show");
    }
    function hideErrorBanner(){ $("#errorBanner").classList.remove("show"); }

    $("#btnHideErr").addEventListener("click", hideErrorBanner);

    axios.interceptors.response.use(
      (r) => r,
      (err) => {
        const status = err?.response?.status;
        const msg = err?.response?.data?.error || (status ? ("HTTP " + status) : "Erro de rede");
        err.__friendly = msg;
        return Promise.reject(err);
      }
    );

    let board = { groups: [] };
    let selected = { groupId: null, itemId: null };
    let selectedRowEl = null;
    let isOffline = false;

    function setOffline(flag){
      isOffline = !!flag;
      $("#btnAddGroup").disabled = isOffline;
      $("#searchInput").disabled = isOffline;
    }

    async function checkApi(){
      try{
        await axios.get(API_BASE + "/health");
        $("#apiStatus").textContent = "API: online";
        $("#apiStatus").className = "badge text-bg-success";
        return true;
      }catch{
        $("#apiStatus").textContent = "API: offline";
        $("#apiStatus").className = "badge text-bg-danger";
        return false;
      }
    }

    async function loadBoard(){
      const q = ($("#searchInput").value || "").trim();
      const res = await axios.get(API_BASE + "/board", { params: q ? { q } : {} });
      board = res.data || { groups: [] };
      renderBoard();
    }

    function escapeHtml(str){
      return String(str)
        .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
        .replaceAll('"',"&quot;").replaceAll("'","&#039;");
    }

    function statusClass(s){
      if(s === "done") return "status-done";
      if(s === "doing") return "status-doing";
      return "status-todo";
    }
    function statusLabel(s){
      if(s === "done") return "Done";
      if(s === "doing") return "In Progress";
      return "To do";
    }
    function prioClass(p){
      if(p === "P1") return "prio-P1";
      if(p === "P2") return "prio-P2";
      return "prio-P3";
    }
    function dateLabel(d){
      if(!d) return "—";
      try { return new Date(String(d).slice(0,10) + "T00:00:00").toLocaleDateString(); } catch { return "—"; }
    }

    function groupStats(g){
      const total = (g.items||[]).length;
      const done = (g.items||[]).filter(i => i.status==="done").length;
      const pct = total ? Math.round(done*100/total) : 0;
      return { total, done, pct };
    }

    function renderBoard(){
      const wrap = $("#groupsWrap");
      wrap.innerHTML = "";

      const groups = board.groups || [];
      if(!groups.length){
        const empty = document.createElement("div");
        empty.className = "group";
        empty.innerHTML = \`
          <div class="group-header">
            <div>
              <div class="group-title">Sem dados</div>
              <div class="group-meta"><span>Cria um grupo quando o DB estiver ok</span></div>
            </div>
          </div>
          <div class="rowx" style="grid-template-columns:1fr;">
            <div class="cell text-muted">
              Se isto estiver no Vercel e “offline”, provavelmente o MySQL está a bloquear ligações remotas.
            </div>
          </div>
        \`;
        wrap.appendChild(empty);
        return;
      }

      for(const g of groups){
        const s = groupStats(g);

        const groupEl = document.createElement("div");
        groupEl.className = "group";
        groupEl.innerHTML = \`
          <div class="group-header">
            <div>
              <div class="group-title">\${escapeHtml(g.title)}</div>
              <div class="group-meta"><span>\${s.done}/\${s.total} done</span><span>•</span><span>\${s.pct}%</span></div>
            </div>
            <div class="d-flex gap-2 flex-wrap">
              <button class="btn btn-primary btn-sm">+ Item</button>
            </div>
          </div>

          <div class="table-head">
            <div class="cell text-muted">#</div>
            <div class="cell">Item</div>
            <div class="cell">Status</div>
            <div class="cell">Priority</div>
            <div class="cell hide-md">Date</div>
            <div class="cell hide-sm">Notes</div>
            <div class="cell text-muted">Ações</div>
          </div>

          <div>
            \${
              (g.items||[]).length
                ? (g.items||[]).map((i, idx) => \`
                  <div class="rowx">
                    <div class="cell text-muted">\${idx+1}</div>
                    <div class="cell">
                      <div class="item-title">\${escapeHtml(i.title)}</div>
                      <div class="small-muted">Atualizado: \${new Date(i.updated_at).toLocaleString()}</div>
                    </div>
                    <div class="cell"><div class="status-pill \${statusClass(i.status)}">\${statusLabel(i.status)}</div></div>
                    <div class="cell"><div class="prio-pill \${prioClass(i.priority)}">\${i.priority}</div></div>
                    <div class="cell hide-md"><div class="date-pill">\${dateLabel(i.due_date)}</div></div>
                    <div class="cell hide-sm"><div class="notes">\${escapeHtml(i.notes || "")}</div></div>
                    <div class="cell row-actions"><button class="icon-btn">…</button></div>
                  </div>
                \`).join("")
                : \`<div class="rowx" style="grid-template-columns:1fr;"><div class="cell text-muted">Sem itens.</div></div>\`
            }
          </div>
        \`;

        wrap.appendChild(groupEl);
      }
    }

    async function hardRefresh(){
      const ok = await checkApi();
      if(!ok){
        setOffline(true);
        showErrorBanner(
          "API/DB offline",
          "O Vercel não conseguiu falar com o teu MySQL (timeout).",
          "Isto geralmente é firewall/porta 3306 bloqueada no hosting (cPanel)."
        );
        return;
      }
      try{
        await loadBoard();
        hideErrorBanner();
        setOffline(false);
      }catch(e){
        setOffline(true);
        showErrorBanner(
          "Sem ligação à base de dados",
          e.__friendly || "Timeout/erro de rede",
          "Confere se o MySQL aceita conexões remotas a partir do Vercel."
        );
      }
    }

    $("#btnReload").addEventListener("click", hardRefresh);
    $("#btnRetry").addEventListener("click", hardRefresh);

    $("#searchInput").addEventListener("input", () => {
      clearTimeout(window.__t);
      window.__t = setTimeout(() => { if(!isOffline) hardRefresh(); }, 300);
    });

    (async function init(){
      await hardRefresh();
    })();
  </script>
</body>
</html>`;
}
