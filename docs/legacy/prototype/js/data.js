/* ============================================================================
   data.js — field-type registry (all 19 types from airtable-tabula + the
   derived row number), sample data, fake Airtable state, legacy .tabula docs
   and import fixtures. No DOM here.
   ========================================================================== */
window.TF = window.TF || {};

TF.data = (function () {
  "use strict";

  var COLORS = ["gray","blue","green","yellow","orange","red","pink","purple","cyan"];

  /* ── field descriptors ─────────────────────────────────────────────────────
     One descriptor per type: how it renders, how it parses text, how it
     compares, which filter operators apply. This is the registry that
     docs/02 says replaces every switch(field.type) spread across 5 modules.
     ---------------------------------------------------------------------- */
  var TYPES = {
    text:       { label: "Single line text", icon: "T",  editable: true,  plain: true,  ops: ["contains","equals","isEmpty","isNotEmpty"], default: "" },
    longText:   { label: "Long text",        icon: "¶",  editable: true,  plain: true,  ops: ["contains","equals","isEmpty","isNotEmpty"], default: "" },
    number:     { label: "Number",           icon: "#",  editable: true,  numeric: true, ops: ["equals","gt","lt","isEmpty"], default: null },
    currency:   { label: "Currency",         icon: "$",  editable: true,  numeric: true, ops: ["equals","gt","lt","isEmpty"], default: null },
    percent:    { label: "Percent",          icon: "%",  editable: true,  numeric: true, ops: ["equals","gt","lt","isEmpty"], default: null },
    duration:   { label: "Duration",         icon: "⏱",  editable: true,  numeric: true, ops: ["equals","gt","lt","isEmpty"], default: null },
    rating:     { label: "Rating",           icon: "★",  editable: true,  numeric: true, ops: ["equals","gt","lt","isEmpty"], default: null },
    checkbox:   { label: "Checkbox",         icon: "☑",  editable: true,  ops: ["isTrue","isFalse"], default: false },
    date:       { label: "Date",             icon: "📅", editable: true,  ops: ["equals","before","after","isEmpty"], default: "" },
    datetime:   { label: "Date & time",      icon: "🕐", editable: true,  ops: ["before","after","isEmpty"], default: "" },
    url:        { label: "URL",              icon: "🔗", editable: true,  plain: true,  ops: ["contains","equals","isEmpty","isNotEmpty"], default: "" },
    email:      { label: "Email",            icon: "@",  editable: true,  plain: true,  ops: ["contains","equals","isEmpty","isNotEmpty"], default: "" },
    phone:      { label: "Phone",            icon: "☎",  editable: true,  plain: true,  ops: ["contains","equals","isEmpty","isNotEmpty"], default: "" },
    singleSelect:{ label: "Single select",   icon: "◉",  editable: true,  select: "single", ops: ["is","isNot","isAnyOf","isEmpty"], default: null },
    multiSelect:{ label: "Multiple select",  icon: "◈",  editable: true,  select: "multi",  ops: ["contains","containsAny","containsAll","isEmpty","isNotEmpty"], default: [] },
    attachment: { label: "Attachment",       icon: "▣",  editable: true,  ops: ["isEmpty","isNotEmpty","contains"], default: [] },
    autoNumber: { label: "Auto number",      icon: "№",  editable: false, numeric: true, ops: ["equals","gt","lt","isEmpty"], default: null },
    createdTime:{ label: "Created time",     icon: "🕓", editable: false, ops: ["before","after","isEmpty"], default: "" },
    lastModifiedTime:{ label: "Last modified time", icon: "🕔", editable: false, ops: ["before","after","isEmpty"], default: "" },
  };

  var TYPE_ORDER = ["text","longText","number","currency","percent","duration","rating","checkbox","date","datetime","url","email","phone","singleSelect","multiSelect","attachment","autoNumber","createdTime","lastModifiedTime"];

  var OP_LABELS = {
    contains: "contains", equals: "is", isEmpty: "is empty", isNotEmpty: "is not empty",
    gt: ">", lt: "<", isTrue: "is checked", isFalse: "is unchecked",
    before: "is before", after: "is after", is: "is", isNot: "is not",
    isAnyOf: "is any of", containsAny: "contains any", containsAll: "contains all",
  };

  function descriptor(type) { return TYPES[type] || TYPES.text; }
  function operatorsFor(field) { return descriptor(field && field.type).ops.slice(); }
  function isReadOnly(field) { return !descriptor(field && field.type).editable; }
  function isEmptyValue(v) {
    return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
  }

  /* ── formatting ──────────────────────────────────────────────────────────── */
  function pad(n, w) { return String(n).padStart(w || 2, "0"); }
  function fmtDuration(sec) {
    if (isEmptyValue(sec)) return "";
    var s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + ":" + pad(m) + "h" : m + "m";
  }
  function parseDuration(text, unit) {
    var t = String(text).trim().toLowerCase();
    if (!t) return null;
    /* 1:30 / 1:30:15 are clock-style and always mean h:mm(:ss) */
    var m = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
    /* explicit units win over the field's unit: 45m is 45 minutes, never 45s */
    var u = t.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/);
    if (u && (u[1] || u[2] || u[3])) {
      return Math.round(Number(u[1] || 0) * 3600 + Number(u[2] || 0) * 60 + Number(u[3] || 0));
    }
    /* a bare number is read in the field's own unit */
    var n = Number(t.replace(/[^\d.-]/g, ""));
    if (isNaN(n)) return null;
    if (unit === "minutes") return Math.round(n * 60);
    if (unit === "hours") return Math.round(n * 3600);
    return n;
  }
  function fmtMoney(n, symbol) {
    if (isEmptyValue(n)) return "";
    return (symbol || "$") + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
    if (isNaN(d.getTime())) return iso;
    var mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return mo[d.getMonth()] + " " + d.getDate();
  }
  function fmtDateTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return fmtDate(iso) + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  /* display text for a cell (returns {text, html} — html optional) */
  function formatCell(field, value) {
    if (isEmptyValue(value)) return { text: "", html: "" };
    switch (field.type) {
      case "checkbox": return { text: value ? "true" : "false", html: "" };
      case "duration": return { text: fmtDuration(value), html: "" };
      case "currency": return { text: fmtMoney(value, field.symbol), html: "" };
      case "percent": return { text: value + "%", html: "" };
      case "date": return { text: fmtDate(value), html: "" };
      case "datetime": return { text: fmtDateTime(value), html: "" };
      case "singleSelect": {
        var opt = findOption(field, value);
        return { text: opt ? opt.name : String(value), html: opt ? pillHtml(opt, true) : "" };
      }
      case "multiSelect": {
        var list = Array.isArray(value) ? value : [];
        var pills = list.map(function (id) { var o = findOption(field, id); return o ? pillHtml(o, false) : ""; }).join("");
        return { text: list.map(function (id) { var o = findOption(field, id); return o ? o.name : id; }).join(", "), html: pills };
      }
      case "attachment": {
        var files = Array.isArray(value) ? value : [];
        return { text: files.join(", "), html: files.map(function (f) { return '<span class="filechip">▣ ' + esc(f) + "</span>"; }).join("") };
      }
      default: return { text: String(value), html: "" };
    }
  }

  /* plain text for clipboard / export */
  function toPlain(field, value) {
    if (isEmptyValue(value)) return "";
    switch (field.type) {
      case "checkbox": return value ? "true" : "false";
      case "duration": return fmtDuration(value);
      case "percent": return String(value);
      case "date": case "datetime": return String(value);
      case "singleSelect": { var o = findOption(field, value); return o ? o.name : String(value); }
      case "multiSelect": {
        var list = Array.isArray(value) ? value : [];
        return list.map(function (id) { var o = findOption(field, id); return o ? o.name : id; }).join(", ");
      }
      case "attachment": return (Array.isArray(value) ? value : []).join(", ");
      default: return String(value);
    }
  }

  /* text (from a paste or typed editor) → canonical value */
  function fromPlain(field, text) {
    var t = String(text == null ? "" : text).trim();
    if (field.type === "checkbox") return /^(true|yes|1|x|✓)$/i.test(t);
    if (t === "") return field.type === "multiSelect" || field.type === "attachment" ? [] : field.type === "checkbox" ? false : null;
    switch (field.type) {
      case "number": case "currency": case "percent": {
        var n = Number(t.replace(/[^0-9.\-]/g, ""));
        return isNaN(n) ? null : n;
      }
      case "duration": return parseDuration(t, field.unit);
      case "rating": { var r = Number(t.replace(/[^0-9]/g, "")); return isNaN(r) ? null : Math.max(0, Math.min(field.max || 5, r)); }
      case "multiSelect": {
        return t.split(",").map(function (s) { return resolveOption(field, s.trim()); }).filter(Boolean);
      }
      case "singleSelect": return resolveOption(field, t);
      case "attachment": return t.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      default: return t;
    }
  }

  function findOption(field, id) {
    if (!field.options) return null;
    for (var i = 0; i < field.options.length; i++) if (field.options[i].id === id) return field.options[i];
    return null;
  }
  function findOptionByName(field, name) {
    if (!field.options) return null;
    var n = String(name).trim().toLowerCase();
    for (var i = 0; i < field.options.length; i++) if (field.options[i].name.toLowerCase() === n) return field.options[i];
    return null;
  }
  /* label → option id, creating the option when it doesn't exist (create-on-type) */
  function resolveOption(field, name) {
    if (!name) return null;
    var existing = findOptionByName(field, name) || findOption(field, name);
    if (existing) return existing.id;
    if (!field._autoCreate) return null;
    var opt = { id: "o" + Math.random().toString(36).slice(2, 8), name: String(name), color: COLORS[field.options.length % COLORS.length] };
    field.options.push(opt);
    return opt.id;
  }
  function pillHtml(opt, withDot) {
    return '<span class="pill pill--' + opt.color + '">' + (withDot ? '<span class="pill-dot"></span>' : "") + esc(opt.name) + "</span>";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  /* ── the sample dataset (30 rows × 20 columns, every field type) ───────── */
  var STATUS = [
    { id: "s_todo", name: "Todo", color: "gray" },
    { id: "s_prog", name: "In progress", color: "blue" },
    { id: "s_block", name: "Blocked", color: "red" },
    { id: "s_review", name: "In review", color: "purple" },
    { id: "s_done", name: "Done", color: "green" },
  ];
  var TAGS = [
    { id: "t_design", name: "design", color: "purple" },
    { id: "t_urgent", name: "urgent", color: "red" },
    { id: "t_docs", name: "docs", color: "cyan" },
    { id: "t_mobile", name: "mobile", color: "orange" },
    { id: "t_sync", name: "sync", color: "yellow" },
    { id: "t_perf", name: "perf", color: "pink" },
  ];

  function sampleFields() {
    return [
      { id: "f_task", name: "Task", type: "text", primary: true, width: 290 },
      { id: "f_status", name: "Status", type: "singleSelect", width: 132, options: STATUS.map(clone) },
      { id: "f_tags", name: "Tags", type: "multiSelect", width: 178, options: TAGS.map(clone) },
      { id: "f_owner", name: "Owner", type: "text", width: 120 },
      { id: "f_due", name: "Due", type: "date", width: 110 },
      { id: "f_start", name: "Starts", type: "datetime", width: 140 },
      { id: "f_est", name: "Estimate", type: "duration", width: 108, unit: "seconds" },
      { id: "f_budget", name: "Budget", type: "currency", width: 118, symbol: "$" },
      { id: "f_progress", name: "Progress", type: "percent", width: 146 },
      { id: "f_conf", name: "Confidence", type: "rating", width: 122, max: 5 },
      { id: "f_done", name: "Done", type: "checkbox", width: 84 },
      { id: "f_notes", name: "Notes", type: "longText", width: 250 },
      { id: "f_spec", name: "Spec", type: "url", width: 200 },
      { id: "f_contact", name: "Contact", type: "email", width: 180 },
      { id: "f_phone", name: "Phone", type: "phone", width: 130 },
      { id: "f_ref", name: "Ref", type: "autoNumber", width: 76 },
      { id: "f_created", name: "Created", type: "createdTime", width: 130 },
      { id: "f_modified", name: "Modified", type: "lastModifiedTime", width: 130 },
      { id: "f_assets", name: "Assets", type: "attachment", width: 190 },
    ];
  }

  /* [task, status, tags, owner, due, starts, estimate(sec), budget, progress, conf, done, notes, spec, contact, phone, assets] */
  var RAW = [
    ["Fix grid height chain on mobile","s_prog",["t_urgent","t_mobile"],"Ayesha","2026-10-09","2026-10-01T09:30",7200,4200,70,4,false,"Mount collapses when the keyboard opens; reproduce with a squeezed host.","docs/04-layout.md","ayesha@example.com","+880 1711 000111","mock-tall.png"],
    ["Range selection + block paste","s_prog",["t_design"],"Rafi","2026-10-14","2026-10-02T11:00",14400,6800,55,4,false,"TSV and HTML both directions. 400x6 target.","docs/01-spec.md","rafi@example.com","+880 1711 000222",""],
    ["Write queue: coalesce per file","s_review",["t_perf","t_sync"],"Ayesha","2026-10-08","2026-09-29T08:15",5400,3100,90,5,false,"One frontmatter write per file per flush.","docs/02-arch.md","ayesha@example.com","+880 1711 000111","queue-trace.txt"],
    ["Import preview dialog","s_todo",["t_docs"],"Nadia","2026-10-21","",10800,5200,15,3,false,"Must warn above 250 rows and offer the file-based alternative.","docs/03-data.md","nadia@example.com","",""],
    ["Frozen primary column","s_done",["t_design","t_perf"],"Rafi","2026-10-02","2026-09-27T14:00",8100,4400,100,5,true,"Transform layer, rAF-synced, drift under 1px.","docs/04-layout.md","rafi@example.com","+880 1711 000222",""],
    ["Select option colours in view config","s_todo",["t_design"],"Ayesha","2026-10-23","",3600,1800,20,3,false,"fieldOptions sidecar keeps notes readable.","docs/03-data.md","ayesha@example.com","+880 1711 000111",""],
    ["Airtable pull with per-field diff","s_block",["t_sync","t_urgent"],"Ishaan","2026-10-07","2026-10-03T16:45",16200,9600,35,2,false,"Blocked: needs the snapshot hash format settled.","docs/02-arch.md","ishaan@example.com","+880 1711 000333",""],
    ["Keyboard navigation model","s_done",["t_design"],"Rafi","2026-09-30","2026-09-24T10:00",9900,6100,100,5,true,"One handler, roving tabindex, full key table.","docs/01-spec.md","rafi@example.com","+880 1711 000222",""],
    ["Row windowing, 5k rows","s_prog",["t_perf"],"Ayesha","2026-10-16","2026-10-04T09:00",12600,7300,60,4,false,"Fixed per-density heights, overscan 8.","docs/02-arch.md","ayesha@example.com","+880 1711 000111","perf-run-12.json"],
    ["Undo across multi-note writes","s_todo",["t_design","t_perf"],"Nadia","2026-10-27","",10800,5900,10,3,false,"One undo step per paste, not per cell.","docs/02-arch.md","nadia@example.com","",""],
    ["Legacy .tabula migration","s_todo",["t_docs"],"Ishaan","2026-11-03","",18000,4200,0,2,false,"Dry run first; mapping file keeps the sync linkage.","docs/03-data.md","ishaan@example.com","+880 1711 000333","legacy-multitable.tabula"],
    ["Theme leak: controls repainted","s_done",["t_urgent"],"Rafi","2026-09-28","2026-09-25T13:20",2700,900,100,5,true,"Root cause: inline important on SVGs. Deleted.","docs/04-layout.md","rafi@example.com","+880 1711 000222",""],
    ["CSV / XLSX export","s_todo",["t_docs"],"Nadia","2026-11-06","",7200,2400,5,3,false,"Selection or whole view. CSV stays Obsidian's.","docs/01-spec.md","nadia@example.com","",""],
    ["Touch: long-press context menu","s_prog",["t_mobile"],"Ayesha","2026-10-19","2026-10-05T08:40",5400,2100,45,4,false,"600ms with visual feedback; toolbar fallback.","docs/04-layout.md","ayesha@example.com","+880 1711 000111",""],
    ["Column resize + reorder drag","s_prog",["t_design"],"Rafi","2026-10-18","",6300,2800,50,4,false,"Pointer capture on the container, no document listeners.","docs/04-layout.md","rafi@example.com","+880 1711 000222",""],
    ["Empty and no-match states","s_todo",["t_docs"],"Nadia","2026-10-29","",1800,0,0,3,false,"","docs/04-layout.md","nadia@example.com","",""],
    ["Percent + duration conventions","s_review",["t_docs"],"Ishaan","2026-10-11","",1800,600,80,4,false,"25 means 25%. Deliberate divergence from Airtable.","docs/03-data.md","ishaan@example.com","+880 1711 000333",""],
    ["Sync: schema never modified","s_done",["t_sync"],"Ishaan","2026-10-01","2026-09-26T15:10",3600,1200,100,5,true,"Read-only on fields and tables, forever.","docs/02-arch.md","ishaan@example.com","+880 1711 000333",""],
    ["Bundle budget gate in CI","s_todo",["t_perf"],"Ayesha","2026-11-01","",4500,1500,0,3,false,"900 KB / 300 KB gzip / 250 KB non-React.","docs/05-toolchain.md","ayesha@example.com","+880 1711 000111",""],
    ["Grouped sections in the grid","s_review",["t_design","t_mobile"],"Rafi","2026-10-15","",8100,3900,75,4,false,"Group bars span the frozen layer seamlessly.","docs/04-layout.md","rafi@example.com","+880 1711 000222","group-sketch.png"],
    ["Screen reader: navigate and read","s_todo",["t_docs"],"Nadia","2026-11-10","",14400,3600,0,2,false,"Roles and aria-rowcount; editing announcement is a known limit.","docs/04-layout.md","nadia@example.com","",""],
    ["Conflict review dialog","s_todo",["t_sync"],"Ishaan","2026-11-04","",10800,5400,0,3,false,"Per-field side by side, bulk take-local, visible counts.","docs/03-data.md","ishaan@example.com","+880 1711 000333",""],
    ["Harness: 5 viewports","s_prog",["t_mobile","t_perf"],"Ayesha","2026-10-13","",7200,3300,85,5,false,"Including the 389px squeeze that broke the old build.","docs/07-test-plan.md","ayesha@example.com","+880 1711 000111","phone-closed.png"],
    ["Token system audit","s_done",["t_design"],"Rafi","2026-09-27","2026-09-23T09:00",3600,1500,100,5,true,"Zero important rules. Two-level selectors. Theme vars only.","docs/04-layout.md","rafi@example.com","+880 1711 000222",""],
    ["Search folded into the query AST","s_todo",["t_docs"],"Nadia","2026-10-25","",5400,1800,0,3,false,"No separate search concept. One AST, one parser.","docs/02-arch.md","nadia@example.com","",""],
    ["Note creation from paste","s_prog",["t_design"],"Ishaan","2026-10-20","",9900,4700,40,4,false,"createFileForView when possible, folder fallback.","docs/03-data.md","ishaan@example.com","+880 1711 000333",""],
    ["Formula properties read-only","s_review",["t_docs"],"Nadia","2026-10-17","",2700,1200,70,4,false,"Disabled cell with a reason, never a dead input.","docs/03-data.md","nadia@example.com","",""],
    ["Startup: don't parse sync","s_todo",["t_perf","t_sync"],"Ayesha","2026-11-07","",3600,900,0,3,false,"Dynamic import on first use only.","docs/02-arch.md","ayesha@example.com","+880 1711 000111",""],
    ["Attachment cell editor","s_review",["t_design"],"Rafi","2026-10-12","",2000,0,65,4,false,"Chips with add/remove; vault-relative paths.","docs/03-data.md","rafi@example.com","+880 1711 000222",""],
    ["View presets (save/load)","s_todo",["t_design","t_docs"],"Nadia","2026-11-12","",5400,2000,0,3,false,"Named views store filters, sorts, grouping and widths.","docs/01-spec.md","nadia@example.com","",""],
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function iso(daysAgo, hour) {
    var d = new Date(2026, 9, 5, hour || 9, 0, 0); // 2026-10-05
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
  }

  function sampleRows() {
    return RAW.map(function (r, i) {
      return {
        id: "r" + (i + 1),
        cells: {
          f_task: r[0], f_status: r[1], f_tags: r[2].slice(), f_owner: r[3],
          f_due: r[4], f_start: r[5], f_est: r[6], f_budget: r[7], f_progress: r[8],
          f_conf: r[9], f_done: r[10], f_notes: r[11], f_spec: r[12],
          f_contact: r[13], f_phone: r[14], f_ref: i + 1,
          f_created: iso(20 + i, 9), f_modified: iso(i % 7, 14 + (i % 6)),
          f_assets: r[15] ? [r[15]] : [],
        },
      };
    });
  }

  function sampleTable() {
    return {
      id: "tbl_projects", name: "Tasks",
      fields: sampleFields(), rows: sampleRows(),
      autoNumberNext: RAW.length + 1,
      sync: null,
    };
  }

  /* a second, smaller table — used by the legacy stacked-tables view */
  function sampleTableSmall() {
    return {
      id: "tbl_people", name: "People",
      fields: [
        { id: "p_name", name: "Name", type: "text", primary: true, width: 200 },
        { id: "p_role", name: "Role", type: "singleSelect", width: 150, options: [
          { id: "role_pm", name: "PM", color: "blue" }, { id: "role_dev", name: "Dev", color: "green" }, { id: "role_design", name: "Design", color: "purple" } ] },
        { id: "p_timezone", name: "Timezone", type: "text", width: 160 },
        { id: "p_capacity", name: "Capacity", type: "percent", width: 120 },
      ],
      rows: [
        { id: "pp1", cells: { p_name: "Ayesha", p_role: "role_eng", p_timezone: "Asia/Dhaka", p_capacity: 80 } },
        { id: "pp2", cells: { p_name: "Rafi", p_role: "role_design", p_timezone: "Asia/Dhaka", p_capacity: 60 } },
        { id: "pp3", cells: { p_name: "Nadia", p_role: "role_pm", p_timezone: "Europe/Berlin", p_capacity: 100 } },
        { id: "pp4", cells: { p_name: "Ishaan", p_role: "role_eng", p_timezone: "Asia/Kolkata", p_capacity: 70 } },
      ],
      autoNumberNext: 5,
      sync: null,
    };
  }

  /* ── legacy .tabula documents (the frozen format from the fork) ────────────
     v1: a bare single-table document.  v2: {version:2, tables:[{id, table}]}.
     ---------------------------------------------------------------------- */
  function legacyV1() {
    var t = sampleTable();
    return { version: 1, name: t.name, fields: t.fields, rows: t.rows, view: { sorts: [], filters: { logic: "and", conditions: [] }, search: "", query: "", hiddenFieldIds: [], groupBy: { fieldId: null }, columnWidths: {}, rowHeight: "medium", frozenPrimary: false }, autoNumberNext: t.autoNumberNext, sync: null };
  }
  function legacyV2() {
    return { version: 2, tables: [ { id: "t_legacy_1", table: legacyV1() }, { id: "t_legacy_2", table: sampleTableSmall() } ] };
  }
  /* deliberately broken rows, to prove the parser reports instead of crashing */
  function legacyCorrupt() {
    return { version: 1, name: "Broken", fields: [ { id: "b1", name: "Name", type: "text" }, { id: "b2", name: "Mystery", type: "notARealType" } ], rows: [ { id: "br1", cells: { b1: "ok", b2: "??" } }, { cells: null } ], view: {} };
  }

  /* ── fake Airtable side (for the sync engine) ──────────────────────────────
     Remote records are derived from the local table so the demo starts in
     sync, then we apply deliberate drift:
       · 3 remote-only edits
       · 1 edit on BOTH sides on the same field  → a real conflict
       · 1 remote-only new record                → pull creates a note
       · 1 locally deleted record                → remote delete is reported
       · 2 local fields with no remote counterpart → skipped + reported
     ---------------------------------------------------------------------- */
  function remoteRecords(rows, fields) {
    var out = {};
    rows.forEach(function (row, i) {
      var rec = { id: "rec" + String(1000 + i) };
      fields.forEach(function (f) {
        if (f.type === "autoNumber" || f.type === "createdTime" || f.type === "lastModifiedTime") return;
        var v = row.cells[f.id];
        rec[f.id] = Array.isArray(v) ? v.slice() : v;
      });
      out[row.id] = rec;
    });
    // remote-only edits
    out["r2"].f_progress = 80;
    out["r5"].f_owner = "Rafi (remote)";
    out["r9"].f_est = 18000;
    // conflict: remote changed the field, and so did we (see driftLocal)
    out["r3"].f_budget = 9000;
    // remote-only new record
    out["__remote_new__"] = { id: "recNEW", f_task: "Created in Airtable", f_status: "s_todo", f_tags: ["t_sync"], f_owner: "Remote", f_progress: 0, f_conf: 3, f_done: false, f_notes: "Arrived from the remote side." };
    return { records: out, base: { id: "appDemoBase", name: "Demo Base" }, table: { id: "tblDemoTasks", name: "Tasks" } };
  }

  function driftLocal(table) {
    var t = clone(table);
    ["r3"].forEach(function (id) {
      var row = t.rows.filter(function (r) { return r.id === id; })[0];
      if (row) row.cells.f_budget = 5150;      // vs remote 9000 → conflict
    });
    var r12 = t.rows.filter(function (r) { return r.id === "r12"; })[0];
    if (r12) r12.cells.f_notes = "Locally edited and never pushed.";  // local-only change
    return t;
  }

  /* ── import fixtures ────────────────────────────────────────────────────── */
  var SAMPLE_CSV = [
    "Company,Contact,Email,Stage,Value,Next step,Last touch",
    "Northwind Traders,Amina Rahman,amina@northwind.example,Qualified,12400,Book technical call,2026-09-28",
    "Contoso Ltd,Daniel Okafor,daniel@contoso.example,Proposal,38900,Send revised pricing,2026-10-01",
    "Fabrikam,Aiko Tanaka,aiko@fabrikam.example,Discovery,7200,Confirm requirements,2026-09-22",
    "Tailspin Toys,Marco Silva,marco@tailspin.example,Won,55000,Kickoff scheduled,2026-10-03",
    "Adventure Works,Priya Nair,priya@adventure.example,Lost,0,Revisit next quarter,2026-09-15",
    "Litware Inc,Tom Fischer,tom@litware.example,Qualified,19800,Security review,2026-09-29",
    "Proseware,Sofia Rossi,sofia@proseware.example,Proposal,26400,Legal redlines,2026-10-02",
    "Wide World Importers,Kenji Sato,kenji@wideworld.example,Discovery,9100,Map integrations,2026-09-25",
    "Blue Yonder Airlines,Lena Novak,lena@blueyonder.example,Qualified,14750,Budget approval,2026-09-30",
    "Lucerne Publishing,Ahmed Haddad,ahmed@lucerne.example,Won,31200,Handover doc,2026-10-04",
    "Coho Vineyard,Olivia Bennett,olivia@coho.example,Proposal,22600,Contract draft,2026-10-02",
    "Wingtip Toys,Sam Whitfield,sam@wingtip.example,Discovery,6400,Scope workshop,2026-09-26",
    "Margie's Travel,Yusuf Karim,yusuf@margies.example,Qualified,17300,Partner intro,2026-10-01",
  ].join("\n");

  /* a real 412-row sheet, generated — drives the import threshold warning */
  function bigSheetMatrix() {
    var rows = [["Order", "Customer", "Region", "Units", "Unit price", "Placed", "Shipped"]];
    var regions = ["APAC", "EMEA", "LATAM", "NA"];
    for (var i = 1; i <= 412; i++) {
      var units = 1 + ((i * 7) % 40);
      var price = 12 + ((i * 13) % 180);
      var month = 1 + (i % 12);
      var day = 1 + (i % 27);
      rows.push([
        "ORD-" + (1000 + i),
        "Customer " + (1 + (i % 60)),
        regions[i % regions.length],
        units,
        price,
        "2026-" + pad(month) + "-" + pad(day),
        i % 9 === 0 ? "" : "2026-" + pad(Math.min(12, month + 1)) + "-" + pad(day),
      ]);
    }
    return rows;
  }

  return {
    COLORS: COLORS, TYPES: TYPES, TYPE_ORDER: TYPE_ORDER, OP_LABELS: OP_LABELS,
    descriptor: descriptor, operatorsFor: operatorsFor, isReadOnly: isReadOnly, isEmptyValue: isEmptyValue,
    formatCell: formatCell, toPlain: toPlain, fromPlain: fromPlain,
    findOption: findOption, findOptionByName: findOptionByName, resolveOption: resolveOption,
    fmtDuration: fmtDuration, parseDuration: parseDuration, fmtMoney: fmtMoney, fmtDate: fmtDate, fmtDateTime: fmtDateTime, toLocalInput: toLocalInput,
    esc: esc, clone: clone, pad: pad, iso: iso,
    sampleTable: sampleTable, sampleTableSmall: sampleTableSmall,
    legacyV1: legacyV1, legacyV2: legacyV2, legacyCorrupt: legacyCorrupt,
    remoteRecords: remoteRecords, driftLocal: driftLocal,
    SAMPLE_CSV: SAMPLE_CSV, bigSheetMatrix: bigSheetMatrix,
  };
})();
