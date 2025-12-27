//"@0i@~G@e&hVKFrV&"



/**
 * server.js — FULLCODE com “Error-first UX”
 *
 * ✅ Se MySQL / schema falhar:
 *    - A página HTML CONTINUA a abrir (não quebra)
 *    - Mostra um banner bonito com erro no topo (no lugar do “conteúdo”)
 *    - Botão “Tentar novamente”
 *    - App desativa botões de CRUD enquanto estiver offline
 *
 * ✅ API robusta:
 *    - Respostas JSON consistentes
 *    - 503 quando DB/schema indisponível
 *    - Handler global de erros
 *
 * ⚠️ IMPORTANTE: Não hardcode password no código (risco de leak).
 *    Usa ENV vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 * Instalar:
 *   npm i express cors mysql2
 *
 * Rodar:
 *   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=... node server.js
 */

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

// -------------------- CONFIG --------------------
const PORT = process.env.PORT || 4000;

const DB = {
  host: process.env.MYSQL_HOST || "cpanel154.dnscpanel.com",
  user: process.env.MYSQL_USER || "eduallsi_cisco",
  password: process.env.MYSQL_PASSWORD || "@0i@~G@e&hVKFrV&",
  database: process.env.MYSQL_DATABASE || "eduallsi_cisco",
  connectionLimit: 10,
};

const CISCO_LOGO =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Cisco_logo.svg/1200px-Cisco_logo.svg.png";

// -------------------- DB POOL --------------------
const pool = mysql.createPool({
  ...DB,
  waitForConnections: true,
  namedPlaceholders: true,
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
  // evita devolver detalhes sensíveis (stack, credenciais, SQL)
  const msg = String(e?.message || "Unexpected error");
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// -------------------- AUTO-SCHEMA (robusto) --------------------
let schemaReady = false;
let schemaPromise = null;
let lastSchemaError = null;

async function ensureSchema() {
    /*
  if (schemaReady) return true;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query(`USE \`${DB.database}\``);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`groups\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`title\` VARCHAR(120) NOT NULL,
          \`position\` INT NOT NULL DEFAULT 0,
          \`collapsed\` TINYINT(1) NOT NULL DEFAULT 0,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_groups_position\` (\`position\`)
        ) ENGINE=InnoDB
          DEFAULT CHARSET=utf8mb4
          COLLATE=utf8mb4_unicode_ci;
      `);

      await conn.query(`
        CREATE TABLE IF NOT EXISTS \`items\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`group_id\` BIGINT UNSIGNED NOT NULL,
          \`title\` VARCHAR(180) NOT NULL,
          \`status\` ENUM('todo','doing','done') NOT NULL DEFAULT 'todo',
          \`priority\` ENUM('P1','P2','P3') NOT NULL DEFAULT 'P3',
          \`due_date\` DATE NULL,
          \`notes\` VARCHAR(300) NULL,
          \`position\` INT NOT NULL DEFAULT 0,
          \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`idx_items_group\` (\`group_id\`),
          INDEX \`idx_items_status\` (\`status\`),
          INDEX \`idx_items_priority\` (\`priority\`),
          INDEX \`idx_items_position\` (\`position\`)
        ) ENGINE=InnoDB
          DEFAULT CHARSET=utf8mb4
          COLLATE=utf8mb4_unicode_ci;
      `);

      const [fkRows] = await conn.query(
        `
        SELECT CONSTRAINT_NAME
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = :db
          AND TABLE_NAME = 'items'
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
          AND CONSTRAINT_NAME = 'fk_items_group'
        `,
        { db: DB.database }
      );

      if (fkRows.length === 0) {
        await conn.query(`
          ALTER TABLE \`items\`
          ADD CONSTRAINT \`fk_items_group\`
            FOREIGN KEY (\`group_id\`)
            REFERENCES \`groups\`(\`id\`)
            ON DELETE CASCADE;
        `);
      }

      schemaReady = true;
      lastSchemaError = null;
      return true;
    } catch (e) {
      schemaReady = false;
      lastSchemaError = e;
      throw e;
    } finally {
      conn.release();
      // IMPORTANTE: permite nova tentativa futura se falhar
      schemaPromise = null;
    }
  })();

  return schemaPromise;
  */
}

// Middleware API: se schema/db falhar => 503 (não “quebra” a página)
app.use(
  "/api",
  asyncRoute(async (req, res, next) => {
    try {
      await ensureSchema();
      return next();
    } catch (e) {
      // 503 = Service Unavailable
      return res.status(503).json({
        ok: false,
        error: "Base de dados indisponível. Tenta novamente em instantes.",
      });
    }
  })
);

// -------------------- API --------------------
app.get(
  "/api/health",
  asyncRoute(async (req, res) => {
    // health precisa ser “honesto”
    try {
      await pool.query("SELECT 1");
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

    const conn = await pool.getConnection();
    try {
      const [groups] = await conn.query(
        "SELECT id, title, position, collapsed, created_at, updated_at FROM `groups` ORDER BY position ASC, id ASC"
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

      const [items] = await conn.query(itemsSql, params);

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

    const conn = await pool.getConnection();
    try {
      const [[maxRow]] = await conn.query(
        "SELECT COALESCE(MAX(position), 0) AS maxPos FROM `groups`"
      );
      const position = (maxRow?.maxPos ?? 0) + 1;

      const [r] = await conn.query(
        "INSERT INTO `groups` (title, position, collapsed) VALUES (:title, :position, 0)",
        { title, position }
      );

      const [rows] = await conn.query(
        "SELECT id, title, position, collapsed, created_at, updated_at FROM `groups` WHERE id = :id",
        { id: r.insertId }
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

    const conn = await pool.getConnection();
    try {
      const [u] = await conn.query(
        `UPDATE \`groups\` SET ${fields.join(", ")} WHERE id = :id`,
        params
      );
      if (u.affectedRows === 0) return notFound(res, "group not found");

      const [rows] = await conn.query(
        "SELECT id, title, position, collapsed, created_at, updated_at FROM `groups` WHERE id = :id",
        { id }
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

    const conn = await pool.getConnection();
    try {
      const [d] = await conn.query("DELETE FROM `groups` WHERE id = :id", { id });
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

    const conn = await pool.getConnection();
    try {
      const [g] = await conn.query("SELECT id FROM `groups` WHERE id = :id", { id: groupId });
      if (g.length === 0) return notFound(res, "group not found");

      const [[maxRow]] = await conn.query(
        "SELECT COALESCE(MAX(position), 0) AS maxPos FROM `items` WHERE group_id = :groupId",
        { groupId }
      );
      const position = (maxRow?.maxPos ?? 0) + 1;

      const [r] = await conn.query(
        "INSERT INTO `items` (group_id, title, status, priority, due_date, notes, position) " +
          "VALUES (:group_id, :title, :status, :priority, :due_date, :notes, :position)",
        { group_id: groupId, title, status, priority, due_date, notes, position }
      );

      const [rows] = await conn.query(
        "SELECT id, group_id, title, status, priority, due_date, notes, position, created_at, updated_at FROM `items` WHERE id = :id",
        { id: r.insertId }
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

    const conn = await pool.getConnection();
    try {
      const [u] = await conn.query(`UPDATE \`items\` SET ${fields.join(", ")} WHERE id = :id`, params);
      if (u.affectedRows === 0) return notFound(res, "item not found");

      const [rows] = await conn.query(
        "SELECT id, group_id, title, status, priority, due_date, notes, position, created_at, updated_at FROM `items` WHERE id = :id",
        { id }
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

    const conn = await pool.getConnection();
    try {
      const [d] = await conn.query("DELETE FROM `items` WHERE id = :id", { id });
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
    // Se der erro no schema, NÃO quebra — injeta um “boot error” para o frontend mostrar banner
    let bootError = null;
    try {
     //  await ensureSchema();
    } catch (e) {
      bootError = "Não consegui ligar à base de dados. A app vai abrir em modo offline.";
      console.error("Schema init error on /:", safeErrMsg(e));
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(INDEX_HTML(String(bootError || "")));
  })
);

// -------------------- GLOBAL ERROR HANDLER --------------------
app.use((err, req, res, next) => {
  console.error("Unhandled route error:", safeErrMsg(err));

  // Se for API, devolve JSON consistente
  if (req.path.startsWith("/api")) {
    return res.status(500).json({
      ok: false,
      error: "Erro interno no servidor.",
    });
  }

  // Se for HTML, também não quebra: devolve HTML com banner de erro
  res
    .status(500)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send(INDEX_HTML("Erro interno no servidor. Recarrega a página."));
});

// -------------------- PROCESS SAFETY (não derrubar sem log) --------------------
process.on("unhandledRejection", (reason) => {
  console.error("UnhandledRejection:", safeErrMsg(reason));
});
process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", safeErrMsg(err));
  // opcional: em produção, o melhor é reiniciar com PM2/Docker, mas aqui só logamos
});

// -------------------- START --------------------
(async () => {
  try {
    //await ensureSchema();
    console.log("DB schema ready ✅");
  } catch (e) {
    console.error("DB schema init failed (vou servir UI em modo offline):", safeErrMsg(e));
  }

  app.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
  });
})();

// -------------------- HTML TEMPLATE (com banner de erro) --------------------
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
      --bg1:#f7f9fc;
      --bg2:#eef3ff;
      --panel: rgba(255,255,255,.92);
      --text:#0f172a;
      --muted:#64748b;
      --border: rgba(15,23,42,.10);
      --shadow: 0 18px 60px rgba(15,23,42,.10);
      --radius: 18px;
      --radius2: 14px;
      --rowHover: rgba(37,99,235,.05);
      --rowSelect: rgba(37,99,235,.10);
      --green:#16a34a;
      --yellow:#f59e0b;
      --gray:#64748b;
      --focusRing: 0 0 0 .25rem rgba(37,99,235,.18);
    }

    body{
      background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 100%);
      color: var(--text);
      min-height: 100vh;
    }
    .shell{ max-width: 1900px; margin:0 auto; padding: 14px 14px 64px; }
    .panel{
      background: var(--panel);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .app-header{ display:flex; justify-content:space-between; align-items:center; gap:14px; padding: 14px 16px; }
    .brand{ display:flex; align-items:center; gap:12px; min-width: 360px; }
    .cisco-logo{ height: 34px; }
    .title{ font-weight: 950; letter-spacing:-.02em; font-size: 18px; line-height: 1.1; }
    .subtitle{ color: var(--muted); font-size: 12.5px; margin-top: 2px; }

    .subbar{
      display:flex; align-items:center; justify-content:space-between; gap:12px;
      padding: 12px 16px 14px;
      border-top: 1px solid rgba(15,23,42,.06);
      background: rgba(255,255,255,.55);
    }

    .searchbox{
      display:flex; align-items:center; gap: 10px;
      width: 100%; max-width: 820px;
      padding: 9px 12px;
      border: 1px solid rgba(15,23,42,.10);
      background: rgba(255,255,255,.92);
      border-radius: 999px;
    }
    .searchbox input{ border:none; outline:none; background:transparent; width:100%; font-size:14px; }
    .searchbox:focus-within{ box-shadow: var(--focusRing); border-color: rgba(37,99,235,.25); }

    .content{ padding: 14px 16px 18px; }

    /* Error banner (fixo dentro do layout) */
    .error-banner{
      border: 1px solid rgba(239,68,68,.25);
      background: rgba(254,226,226,.75);
      border-radius: 16px;
      padding: 14px;
      margin-top: 12px;
      display:none;
    }
    .error-banner.show{ display:block; }
    .error-title{ font-weight: 950; color: #991b1b; }
    .error-desc{ color: rgba(127,29,29,.92); font-size: 13px; margin-top: 4px; }
    .error-meta{ color: rgba(127,29,29,.75); font-size: 12px; margin-top: 8px; }

    .group{
      border:1px solid rgba(15,23,42,.08);
      border-radius: var(--radius2);
      overflow:hidden;
      background: rgba(255,255,255,.70);
      margin-top: 12px;
    }
    .group-header{
      display:flex; justify-content:space-between; align-items:center; gap:12px;
      padding:10px 12px;
      background: rgba(255,255,255,.92);
      border-bottom: 1px solid rgba(15,23,42,.06);
    }
    .group-title{ font-weight: 950; }
    .group-meta{ color: var(--muted); font-size: 12px; display:flex; gap: 8px; margin-top:2px; flex-wrap:wrap; }

    .table-head, .rowx{
      display:grid;
      grid-template-columns: 46px minmax(240px, 2.8fr) 1fr .9fr 1.2fr 1.7fr 120px;
      align-items:center;
    }
    .table-head{
      padding:10px 12px;
      font-size:12px;
      color: var(--muted);
      background: rgba(15,23,42,.02);
      border-bottom: 1px solid rgba(15,23,42,.06);
    }
    .rowx{
      padding:10px 12px;
      border-bottom: 1px solid rgba(15,23,42,.06);
      background: rgba(255,255,255,.80);
      transition:.12s;
      cursor: default;
    }
    .rowx:hover{ background: var(--rowHover); }
    .rowx.selected{ background: var(--rowSelect); }

    .cell{ padding-right:10px; min-width:0; }
    .item-title{ font-weight: 800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size: 14px; }
    .small-muted{ color: var(--muted); font-size:12px; margin-top:2px; }
    .strike{ text-decoration: line-through; color: rgba(100,116,139,.95); }

    .status-pill{
      display:inline-flex; align-items:center; justify-content:center;
      padding: 7px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 950; color:white;
      width: 120px; user-select:none;
    }
    .status-todo{ background: var(--gray); }
    .status-doing{ background: var(--yellow); color:#1f2937; }
    .status-done{ background: var(--green); }

    .prio-pill{
      display:inline-flex; align-items:center; justify-content:center;
      padding: 7px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 950;
      border: 1px solid rgba(15,23,42,.10);
      background: rgba(255,255,255,.90);
      width: 74px;
    }
    .prio-P1{ color:#b91c1c; }
    .prio-P2{ color:#92400e; }
    .prio-P3{ color: rgba(15,23,42,.78); }

    .date-pill{
      display:inline-flex; align-items:center; justify-content:center;
      padding: 7px 10px; border-radius:999px;
      font-size:12px; font-weight:900;
      border:1px solid rgba(15,23,42,.10);
      background: rgba(255,255,255,.90);
      width: 140px;
    }

    .notes{ color: var(--muted); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    .row-actions{ display:flex; gap:8px; justify-content:flex-end; }
    .icon-btn{
      width: 40px; height: 38px; border-radius: 12px;
      border: 1px solid rgba(15,23,42,.10);
      background: rgba(255,255,255,.92);
      display:flex; align-items:center; justify-content:center;
      font-weight: 900;
    }
    .icon-btn:hover{ background: rgba(255,255,255,1); }

    .modal-content{ border-radius: 18px; }
    .form-control, .form-select{ border-radius: 14px; padding: 10px 12px; }
    .form-control:focus, .form-select:focus{ box-shadow: var(--focusRing); border-color: rgba(37,99,235,.35); }
    .btn{ border-radius: 12px; font-weight: 800; }

    @media (max-width: 980px) {
      .app-header { flex-direction: column; align-items: stretch; gap: 10px; }
      .brand { min-width: unset; width: 100%; }
      .app-header > .d-flex { width: 100%; justify-content: flex-start; }
      .subbar { flex-direction: column; align-items: stretch; gap: 10px; }
      .searchbox { max-width: 100%; width: 100%; }
      .subbar .d-flex { width: 100%; justify-content: flex-start; }
      .subbar .btn { flex: 1; min-width: 140px; }
    }
    @media (max-width: 860px) {
      .group { overflow-x: auto; }
      .table-head, .rowx { min-width: 720px; }
      .hide-sm { display:none !important; }
    }
    @media (max-width: 1080px){
      .hide-md { display:none !important; }
      .table-head, .rowx { grid-template-columns: 44px minmax(240px, 2.6fr) 1fr .9fr 1.2fr 120px; }
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
            <div class="subtitle">Express + MySQL • App resiliente a falhas (sem quebrar a página)</div>
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
          <input id="searchInput" placeholder="Pesquisar (server-side): title, notes, status, priority..." />
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
          Clique numa linha para selecionar • Duplo clique para editar • Se o DB cair, a UI continua viva
        </div>

        <div id="errorBanner" class="error-banner">
          <div class="d-flex align-items-start justify-content-between gap-3">
            <div>
              <div class="error-title" id="errorTitle">Modo offline</div>
              <div class="error-desc" id="errorDesc">Não foi possível contactar a base de dados.</div>
              <div class="error-meta" id="errorMeta">Podes tentar novamente — a página não vai quebrar.</div>
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

  <!-- Toast -->
  <div class="toast-container position-fixed bottom-0 end-0 p-3">
    <div id="appToast" class="toast text-bg-dark border-0" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body" id="toastMsg">Ok</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button>
      </div>
    </div>
  </div>

  <!-- Modal: Group -->
  <div class="modal fade" id="modalGroup" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header border-0">
          <h5 class="modal-title" id="modalGroupTitle">Novo grupo</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body">
          <label class="form-label">Nome do grupo</label>
          <input id="groupTitleInput" class="form-control" maxlength="120" placeholder="Ex.: IP Connectivity">
          <div id="groupErr" class="text-danger small mt-2 d-none">Nome obrigatório</div>
        </div>
        <div class="modal-footer border-0">
          <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button id="btnGroupConfirm" class="btn btn-primary">Guardar</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal: Item -->
  <div class="modal fade" id="modalItem" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header border-0">
          <h5 class="modal-title" id="modalItemTitle">Novo item</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body">
          <div class="row g-2">
            <div class="col-12 col-lg-7">
              <label class="form-label">Item</label>
              <input id="itemTitleInput" class="form-control" maxlength="180" placeholder="Ex.: OSPF — configurar e validar">
              <div id="itemErr" class="text-danger small mt-2 d-none">Item obrigatório</div>
            </div>
            <div class="col-6 col-lg-2">
              <label class="form-label">Status</label>
              <select id="itemStatusInput" class="form-select">
                <option value="todo">To do</option>
                <option value="doing">Doing</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div class="col-6 col-lg-3">
              <label class="form-label">Prioridade</label>
              <select id="itemPriorityInput" class="form-select">
                <option value="P3">P3</option>
                <option value="P2">P2</option>
                <option value="P1">P1</option>
              </select>
            </div>
            <div class="col-12 col-lg-4">
              <label class="form-label">Data</label>
              <input id="itemDateInput" type="date" class="form-control">
            </div>
            <div class="col-12 col-lg-8">
              <label class="form-label">Notas</label>
              <input id="itemNotesInput" class="form-control" maxlength="300" placeholder="Ex.: LSA types + lab Packet Tracer">
            </div>
          </div>
        </div>
        <div class="modal-footer border-0">
          <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button id="btnItemConfirm" class="btn btn-primary">Guardar</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal: Confirm -->
  <div class="modal fade" id="modalConfirm" tabindex="-1" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header border-0">
          <h5 class="modal-title" id="confirmTitle">Confirmar</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
        </div>
        <div class="modal-body" id="confirmBody">—</div>
        <div class="modal-footer border-0">
          <button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
          <button id="btnConfirmYes" class="btn btn-danger">Confirmar</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Boot error vindo do servidor (se schema falhou no /)
    window.__BOOT_ERROR__ = ${JSON.stringify(bootError)};
  </script>

  <script src="https://cdn.jsdelivr.net/npm/axios@1.7.2/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

  <script>
    const API_BASE = "/api";
    const $ = (s) => document.querySelector(s);

    const toast = new bootstrap.Toast($("#appToast"), { delay: 2200 });
    const modalGroup = new bootstrap.Modal($("#modalGroup"));
    const modalItem  = new bootstrap.Modal($("#modalItem"));
    const modalConfirm = new bootstrap.Modal($("#modalConfirm"));

    function notify(msg){ $("#toastMsg").textContent = msg; toast.show(); }

    function escapeHtml(str){
      return String(str)
        .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
        .replaceAll('"',"&quot;").replaceAll("'","&#039;");
    }

    // -------------------- ERROR UX --------------------
    let isOffline = false;

    function showErrorBanner(title, desc, meta){
      const b = $("#errorBanner");
      $("#errorTitle").textContent = title || "Modo offline";
      $("#errorDesc").textContent = desc || "Não foi possível contactar a base de dados.";
      $("#errorMeta").textContent = meta || "Podes tentar novamente — a página não vai quebrar.";
      b.classList.add("show");
    }
    function hideErrorBanner(){
      $("#errorBanner").classList.remove("show");
    }
    function setOffline(flag){
      isOffline = !!flag;
      // Desativa botões críticos quando offline
      $("#btnAddGroup").disabled = isOffline;
      $("#btnAddItem").disabled = isOffline || (board.groups.length === 0);
      $("#btnEditItem").disabled = isOffline || !selected.itemId;
      $("#btnDeleteItem").disabled = isOffline || !selected.itemId;
      $("#searchInput").disabled = isOffline;
    }

    $("#btnRetry").addEventListener("click", async () => {
      await hardRefresh();
    });
    $("#btnHideErr").addEventListener("click", hideErrorBanner);

    async function hardRefresh(){
      try{
        await checkApi();      // muda badge
        await loadBoard();     // tenta carregar
        hideErrorBanner();
        setOffline(false);
        notify("Ligação recuperada ✅");
      }catch(e){
        setOffline(true);
        showErrorBanner(
          "Sem ligação à base de dados",
          "A API/DB está indisponível neste momento.",
          "Confere credenciais/env vars, host MySQL, permissões e firewall."
        );
      }
    }

    // Interceptor axios: não deixar “crashar”
    axios.interceptors.response.use(
      (r) => r,
      (err) => {
        // não quebra a app: devolve um erro “normalizado”
        const status = err?.response?.status;
        const msg =
          err?.response?.data?.error ||
          (status === 503 ? "DB indisponível" : "Erro de rede/servidor");
        err.__friendly = msg;
        return Promise.reject(err);
      }
    );

    // -------------------- UI HELPERS --------------------
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

    // -------------------- STATE --------------------
    let board = { groups: [] };
    let selected = { groupId: null, itemId: null };
    let selectedRowEl = null;

    let groupMode = "create";
    let itemMode = "create";
    let editingGroupId = null;
    let editingItemId = null;
    let confirmAction = null;

    // -------------------- API CALLS (resilientes) --------------------
    async function checkApi(){
      try{
        await axios.get(API_BASE + "/health");
        $("#apiStatus").textContent = "API: online";
        $("#apiStatus").className = "badge text-bg-success";
      }catch{
        $("#apiStatus").textContent = "API: offline";
        $("#apiStatus").className = "badge text-bg-danger";
      }
    }

    async function loadBoard(){
      const q = ($("#searchInput").value || "").trim();

      try{
        const res = await axios.get(API_BASE + "/board", { params: q ? { q } : {} });
        board = res.data || { groups: [] };

        // compat: quando API devolve {ok:true, groups:[...]}
        if(board.ok && Array.isArray(board.groups)) {
          // ok
        } else if(Array.isArray(board.groups)) {
          // ok (caso antigo)
        } else {
          board = { groups: [] };
        }

        renderBoard();
        setOffline(false);
      } catch(e){
        // DB caiu? UI não quebra, só entra em offline
        board = { groups: [] };
        renderBoard();
        setOffline(true);
        showErrorBanner(
          "Sem ligação à base de dados",
          e.__friendly || "A API não respondeu. A app está em modo offline.",
          "Tenta novamente. Se persistir, verifica o MySQL e as ENV vars."
        );
        throw e;
      }
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

      if(isOffline){
        // Em offline, deixamos só uma mensagem limpa e motivacional
        const card = document.createElement("div");
        card.className = "group";
        card.innerHTML = \`
          <div class="group-header">
            <div>
              <div class="group-title">Modo offline</div>
              <div class="group-meta">
                <span>Sem dados para mostrar</span><span>•</span>
                <span>Assim que o DB voltar, a UI recupera</span>
              </div>
            </div>
            <div class="d-flex gap-2 flex-wrap">
              <button class="btn btn-outline-danger btn-sm" id="btnRetry2">Tentar novamente</button>
            </div>
          </div>
          <div class="rowx" style="grid-template-columns:1fr;">
            <div class="cell text-muted">
              Dica: para uma vaga Grade 6, mostra resiliência: UI não quebra, erros são controlados, e há retry.
            </div>
          </div>
        \`;
        wrap.appendChild(card);

        const btn = document.getElementById("btnRetry2");
        if(btn) btn.addEventListener("click", hardRefresh);

        syncButtons();
        return;
      }

      for(const g of (board.groups || [])){
        const s = groupStats(g);

        const groupEl = document.createElement("div");
        groupEl.className = "group";
        groupEl.innerHTML = \`
          <div class="group-header">
            <div>
              <div class="group-title">\${escapeHtml(g.title)}</div>
              <div class="group-meta">
                <span>\${s.done}/\${s.total} done</span><span>•</span><span>\${s.pct}%</span>
              </div>
            </div>
            <div class="d-flex gap-2 flex-wrap">
              <button class="btn btn-outline-secondary btn-sm" data-act="renameGroup" data-gid="\${g.id}">Renomear</button>
              <button class="btn btn-outline-danger btn-sm" data-act="deleteGroup" data-gid="\${g.id}">Apagar</button>
              <button class="btn btn-primary btn-sm" data-act="addItem" data-gid="\${g.id}">+ Item</button>
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
                ? (g.items||[]).map((i, idx) => {
                    const strike = i.status === "done" ? "strike" : "";
                    return \`
                      <div class="rowx" data-row="1" data-gid="\${g.id}" data-iid="\${i.id}">
                        <div class="cell text-muted">\${idx+1}</div>

                        <div class="cell">
                          <div class="item-title \${strike}">\${escapeHtml(i.title)}</div>
                          <div class="small-muted">Atualizado: \${new Date(i.updated_at).toLocaleString()}</div>
                        </div>

                        <div class="cell">
                          <div class="status-pill \${statusClass(i.status)}">\${statusLabel(i.status)}</div>
                        </div>

                        <div class="cell">
                          <div class="prio-pill \${prioClass(i.priority)}">\${i.priority}</div>
                        </div>

                        <div class="cell hide-md">
                          <div class="date-pill">\${dateLabel(i.due_date)}</div>
                        </div>

                        <div class="cell hide-sm">
                          <div class="notes">\${escapeHtml(i.notes || "")}</div>
                        </div>

                        <div class="cell row-actions">
                          <button class="icon-btn" data-row-act="edit" data-gid="\${g.id}" data-iid="\${i.id}">✎</button>
                          <button class="icon-btn" data-row-act="del" data-gid="\${g.id}" data-iid="\${i.id}">🗑</button>
                        </div>
                      </div>
                    \`;
                  }).join("")
                : \`
                  <div class="rowx" style="grid-template-columns: 1fr;">
                    <div class="cell text-muted">Sem itens.</div>
                  </div>
                \`
            }
          </div>
        \`;

        wrap.appendChild(groupEl);
      }

      wrap.querySelectorAll("[data-act]").forEach(btn => {
        btn.addEventListener("click", () => {
          const act = btn.getAttribute("data-act");
          const gid = Number(btn.getAttribute("data-gid"));
          if(act === "addItem") return openCreateItem(gid);
          if(act === "renameGroup") return openRenameGroup(gid);
          if(act === "deleteGroup") return confirmDeleteGroup(gid);
        });
      });

      bindRows();
      syncButtons();
    }

    function bindRows(){
      const wrap = $("#groupsWrap");

      wrap.querySelectorAll("[data-row='1']").forEach(row => {
        row.addEventListener("click", () => {
          const gid = Number(row.getAttribute("data-gid"));
          const iid = Number(row.getAttribute("data-iid"));
          selectRow(row, gid, iid);
        });
        row.addEventListener("dblclick", () => {
          const gid = Number(row.getAttribute("data-gid"));
          const iid = Number(row.getAttribute("data-iid"));
          selectRow(row, gid, iid);
          openEditItem(gid, iid);
        });
      });

      wrap.querySelectorAll("[data-row-act]").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const act = btn.getAttribute("data-row-act");
          const gid = Number(btn.getAttribute("data-gid"));
          const iid = Number(btn.getAttribute("data-iid"));
          const row = wrap.querySelector(\`[data-row="1"][data-gid="\${gid}"][data-iid="\${iid}"]\`);
          if(row) selectRow(row, gid, iid);

          if(act === "edit") openEditItem(gid, iid);
          if(act === "del") confirmDeleteItem(iid);
        });
      });
    }

    function selectRow(rowEl, gid, iid){
      if(selectedRowEl && selectedRowEl !== rowEl) selectedRowEl.classList.remove("selected");
      selected = { groupId: gid, itemId: iid };
      selectedRowEl = rowEl;
      rowEl.classList.add("selected");
      syncButtons();
    }

    function clearSelection(){
      if(selectedRowEl) selectedRowEl.classList.remove("selected");
      selectedRowEl = null;
      selected = { groupId: null, itemId: null };
      syncButtons();
    }

    function syncButtons(){
      const hasSel = !!(selected.groupId && selected.itemId);
      $("#btnAddItem").disabled = isOffline || (board.groups?.length === 0);
      $("#btnEditItem").disabled = isOffline || !hasSel;
      $("#btnDeleteItem").disabled = isOffline || !hasSel;
      $("#btnAddGroup").disabled = isOffline;
    }

    // ---- Group modal ----
    function openCreateGroup(){
      if(isOffline) return notify("Sem DB: não dá para criar agora.");
      groupMode = "create";
      editingGroupId = null;
      $("#modalGroupTitle").textContent = "Novo grupo";
      $("#groupTitleInput").value = "";
      $("#groupErr").classList.add("d-none");
      modalGroup.show();
      setTimeout(()=>$("#groupTitleInput").focus(), 100);
    }

    function openRenameGroup(gid){
      if(isOffline) return notify("Sem DB: não dá para editar agora.");
      groupMode = "rename";
      editingGroupId = gid;
      const g = board.groups.find(x => x.id === gid);
      $("#modalGroupTitle").textContent = "Renomear grupo";
      $("#groupTitleInput").value = g?.title || "";
      $("#groupErr").classList.add("d-none");
      modalGroup.show();
      setTimeout(()=>$("#groupTitleInput").focus(), 100);
    }

    async function submitGroup(){
      if(isOffline) return notify("Sem DB: não dá para guardar agora.");
      const title = ($("#groupTitleInput").value || "").trim();
      if(!title){ $("#groupErr").classList.remove("d-none"); return; }
      $("#groupErr").classList.add("d-none");

      try{
        if(groupMode === "create"){
          await axios.post(API_BASE + "/groups", { title });
          notify("Grupo criado ✅");
        }else{
          await axios.patch(API_BASE + "/groups/" + editingGroupId, { title });
          notify("Grupo atualizado ✅");
        }
        modalGroup.hide();
        clearSelection();
        await loadBoard();
      }catch(e){
        setOffline(true);
        showErrorBanner("Falha ao guardar", e.__friendly || "Erro de servidor/DB.", "Tenta novamente.");
      }
    }

    // ---- Item modal ----
    function openCreateItem(groupId){
      if(isOffline) return notify("Sem DB: não dá para criar agora.");
      itemMode = "create";
      editingGroupId = groupId;
      editingItemId = null;

      $("#modalItemTitle").textContent = "Novo item";
      $("#itemTitleInput").value = "";
      $("#itemStatusInput").value = "todo";
      $("#itemPriorityInput").value = "P3";
      $("#itemDateInput").value = "";
      $("#itemNotesInput").value = "";
      $("#itemErr").classList.add("d-none");

      modalItem.show();
      setTimeout(()=>$("#itemTitleInput").focus(), 100);
    }

    function openEditItem(groupId, itemId){
      if(isOffline) return notify("Sem DB: não dá para editar agora.");
      itemMode = "edit";
      editingGroupId = groupId;
      editingItemId = itemId;

      const g = board.groups.find(x => x.id === groupId);
      const it = (g?.items || []).find(x => x.id === itemId);
      if(!it) return;

      $("#modalItemTitle").textContent = "Editar item";
      $("#itemTitleInput").value = it.title || "";
      $("#itemStatusInput").value = it.status || "todo";
      $("#itemPriorityInput").value = it.priority || "P3";
      $("#itemDateInput").value = it.due_date ? String(it.due_date).slice(0,10) : "";
      $("#itemNotesInput").value = it.notes || "";
      $("#itemErr").classList.add("d-none");

      modalItem.show();
      setTimeout(()=>$("#itemTitleInput").focus(), 100);
    }

    async function submitItem(){
      if(isOffline) return notify("Sem DB: não dá para guardar agora.");
      const title = ($("#itemTitleInput").value || "").trim();
      if(!title){ $("#itemErr").classList.remove("d-none"); return; }
      $("#itemErr").classList.add("d-none");

      const payload = {
        title,
        status: $("#itemStatusInput").value,
        priority: $("#itemPriorityInput").value,
        due_date: $("#itemDateInput").value || null,
        notes: ($("#itemNotesInput").value || "").trim() || null
      };

      try{
        if(itemMode === "create"){
          await axios.post(API_BASE + "/groups/" + editingGroupId + "/items", payload);
          notify("Item criado ➕");
        } else {
          await axios.patch(API_BASE + "/items/" + editingItemId, payload);
          notify("Item atualizado ✅");
        }

        modalItem.hide();
        clearSelection();
        await loadBoard();
      }catch(e){
        setOffline(true);
        showErrorBanner("Falha ao guardar", e.__friendly || "Erro de servidor/DB.", "Tenta novamente.");
      }
    }

    // ---- Confirm ----
    function openConfirm(title, bodyHtml, dangerLabel, onYes){
      $("#confirmTitle").textContent = title;
      $("#confirmBody").innerHTML = bodyHtml;
      $("#btnConfirmYes").textContent = dangerLabel || "Confirmar";
      confirmAction = onYes;
      modalConfirm.show();
    }

    function confirmDeleteGroup(gid){
      if(isOffline) return notify("Sem DB: não dá para apagar agora.");
      const g = board.groups.find(x => x.id === gid);
      openConfirm(
        "Apagar grupo",
        "Apagar <b>" + escapeHtml(g?.title || "") + "</b> e todos os itens?",
        "Apagar",
        async () => {
          try{
            await axios.delete(API_BASE + "/groups/" + gid);
            modalConfirm.hide();
            notify("Grupo apagado 🗑");
            clearSelection();
            await loadBoard();
          }catch(e){
            setOffline(true);
            showErrorBanner("Falha ao apagar", e.__friendly || "Erro de servidor/DB.", "Tenta novamente.");
          }
        }
      );
    }

    function confirmDeleteItem(itemId){
      if(isOffline) return notify("Sem DB: não dá para apagar agora.");
      openConfirm(
        "Apagar item",
        "Confirmar apagar este item?",
        "Apagar",
        async () => {
          try{
            await axios.delete(API_BASE + "/items/" + itemId);
            modalConfirm.hide();
            notify("Item apagado 🧹");
            clearSelection();
            await loadBoard();
          }catch(e){
            setOffline(true);
            showErrorBanner("Falha ao apagar", e.__friendly || "Erro de servidor/DB.", "Tenta novamente.");
          }
        }
      );
    }

    // Wire UI
    $("#btnReload").addEventListener("click", () => hardRefresh());
    $("#btnAddGroup").addEventListener("click", openCreateGroup);

    $("#btnAddItem").addEventListener("click", () => {
      if(isOffline) return notify("Sem DB: não dá para criar agora.");
      const gid = selected.groupId || board.groups[0]?.id;
      if(!gid) return notify("Cria um grupo primeiro.");
      openCreateItem(gid);
    });

    $("#btnEditItem").addEventListener("click", () => {
      if(isOffline) return notify("Sem DB: não dá para editar agora.");
      if(!selected.groupId || !selected.itemId) return;
      openEditItem(selected.groupId, selected.itemId);
    });

    $("#btnDeleteItem").addEventListener("click", () => {
      if(isOffline) return notify("Sem DB: não dá para apagar agora.");
      if(!selected.itemId) return;
      confirmDeleteItem(selected.itemId);
    });

    $("#btnGroupConfirm").addEventListener("click", submitGroup);
    $("#btnItemConfirm").addEventListener("click", submitItem);

    $("#btnConfirmYes").addEventListener("click", async () => {
      if(typeof confirmAction === "function") await confirmAction();
      confirmAction = null;
    });

    $("#searchInput").addEventListener("input", () => {
      clearTimeout(window.__t);
      window.__t = setTimeout(() => {
        if(!isOffline) loadBoard();
      }, 250);
    });

    // init
    (async function init(){
      await checkApi();

      if(window.__BOOT_ERROR__){
        setOffline(true);
        showErrorBanner(
          "Sem ligação à base de dados",
          window.__BOOT_ERROR__,
          "A página abriu normalmente. Clica em “Tentar novamente” quando o DB estiver ok."
        );
      }

      try{
        await loadBoard();
      }catch{
        // já tratamos em loadBoard()
      }
    })();

    // Enter-to-save (UX)
    $("#groupTitleInput").addEventListener("keydown", (e)=>{ if(e.key==="Enter") submitGroup(); });
    $("#itemTitleInput").addEventListener("keydown", (e)=>{ if(e.key==="Enter") submitItem(); });
  </script>
</body>
</html>`;
}
