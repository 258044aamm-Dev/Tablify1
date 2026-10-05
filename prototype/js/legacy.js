/* ============================================================================
   legacy.js — the .tabula bridge.
     · a real parser for the frozen format (v1 bare table, v2 {tables:[…]})
     · reports instead of throwing, and keeps the raw JSON visible
     · the "stacked tables with a wide scrollbar on top" presentation, which is
       the thing the old plugin actually got right and people relied on
     · a dry-run report + one-way migration into a normal Tablify table
   Nothing here ever writes back to a .tabula file.
   ========================================================================== */
window.TF = window.TF || {};

TF.legacy = (function () {
  "use strict";
  var D = TF.data;

  /* ── parsing ───────────────────────────────────────────────────────────── */
  function normalize(raw, id, label) {
    var out = {
      id: id, name: label, version: "version " + (raw && raw.version ? raw.version : "?"),
      createdAt: "2024-11-03T09:12:00.000Z", valid: true, error: null, raw: raw, tables: [],
    };
    if (!raw || typeof raw !== "object") {
      out.valid = false; out.error = "not an object";
      return out;
    }
    var problems = [];
    var tables = [];
    if (raw.version === 2 && Array.isArray(raw.tables)) {
      raw.tables.forEach(function (entry, i) {
        var t = entry && entry.table ? entry.table : entry;
        if (!t || !t.fields || !t.rows) { problems.push("table " + (i + 1) + " is missing fields or rows"); return; }
        tables.push(t);
      });
    } else if (raw.fields && raw.rows) {
      tables.push(raw);
    } else {
      problems.push("no fields/rows and no tables array");
    }

    tables.forEach(function (t, ti) {
      var fields = [];
      (t.fields || []).forEach(function (f) {
        var known = !!D.TYPES[f.type];
        if (!known) problems.push("field “" + (f.name || f.id) + "” has an unknown type “" + f.type + "”");
        fields.push({
          id: f.id, name: f.name || ("Column " + f.id), type: known ? f.type : "text",
          from: known ? null : f.type, options: f.options || null, width: f.width || 140,
        });
      });
      var rows = [];
      (t.rows || []).forEach(function (r, ri) {
        if (!r || !r.cells) { problems.push("row " + (ri + 1) + " has no cells object"); return; }
        rows.push(r);
      });
      out.tables.push({
        id: "legacy_tbl_" + id + "_" + ti, name: t.name || ("Table " + (ti + 1)),
        fields: fields, rows: rows,
        formula: t.view && t.view.query ? t.view.query : (t.view && t.view.filters && t.view.filters.conditions && t.view.filters.conditions.length ? t.view.filters.conditions.length + " legacy filter(s)" : "ROWS()"),
        filtersDriven: t.view && t.view.filters ? t.view.filters.conditions.length : 0,
        rowHeight: (t.view && t.view.rowHeight) || "medium",
      });
    });

    if (problems.length) { out.valid = false; out.error = problems.join("; "); }
    if (!out.tables.length && out.valid) { out.valid = false; out.error = "the file contains no readable tables"; }
    return out;
  }

  function docs() {
    return [
      normalize(D.legacyV2(), "v2", "Project plan.tabula"),
      normalize(D.legacyV1(), "v1", "Content calendar.tabula"),
      normalize(D.legacyCorrupt(), "corrupt", "Broken import.tabula"),
    ];
  }
  function docById(id) {
    var all = docs();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return all[0];
  }

  /* ── the report behind the dry run ─────────────────────────────────────── */
  var COMPUTED = ["autoNumber", "createdTime", "lastModifiedTime"];
  function report(table) {
    var columns = table.fields.map(function (f) {
      var computed = COMPUTED.indexOf(f.type) !== -1;
      var migratable = true;
      var note = "front-matter key “" + keyName(f.name) + "”";
      if (f.from) note = "unknown legacy type “" + f.from + "” → kept as text";
      if (computed) note = "recomputed on import (values recalculated, not copied)";
      return { name: f.name, from: f.from || f.type, to: f.type, computed: computed, migratable: migratable, note: note, field: f };
    });
    var missingPrimary = table.rows.filter(function (r) {
      var first = table.fields[0];
      return first && D.isEmptyValue(r.cells[first.id]);
    }).length;
    return {
      doc: null, table: table, columns: columns, rows: table.rows.length,
      computed: columns.filter(function (c) { return c.computed; }).length,
      unmappable: columns.filter(function (c) { return !c.migratable; }),
      missingPrimary: missingPrimary,
      files: table.rows.length,
    };
  }
  function keyName(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_"); }

  /* one-way migration: fresh ids, so nothing can point back at the old file */
  function toTable(table, store) {
    var fields = table.fields.map(function (f, i) {
      var nf = {
        id: "f_" + Math.random().toString(36).slice(2, 9),
        name: f.name + (f.from ? " (was " + f.from + ")" : ""),
        type: f.type, width: f.width || 150,
      };
      if (f.options) nf.options = D.clone(f.options);
      if (f.type === "currency") nf.symbol = "$";
      if (f.type === "rating") nf.max = 5;
      if (i === 0) nf.primary = true;
      return nf;
    });
    var rows = table.rows.map(function (r) {
      var cells = {};
      fields.forEach(function (nf, i) {
        var src = table.fields[i];
        var v = r.cells[src.id];
        var computed = COMPUTED.indexOf(nf.type) !== -1;
        if (computed) {
          cells[nf.id] = nf.type === "autoNumber" ? (table.rows.indexOf(r) + 1) : new Date().toISOString();
          return;
        }
        cells[nf.id] = v === undefined || v === null ? D.clone(D.descriptor(nf.type).default) : (Array.isArray(v) ? v.slice() : v);
      });
      return { id: "r_" + Math.random().toString(36).slice(2, 9), cells: cells };
    });
    return { fields: fields, rows: rows };
  }

  /* ── rendering the legacy screen ───────────────────────────────────────── */
  function render(host, store, ctx) {
    var st = store.get();
    var ids = ["v2", "v1", "corrupt"];
    var current = ids[Math.min(st.legacy.activeDocIndex || 0, ids.length - 1)];
    var doc = docById(current);
    host.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "legacy-wrap";
    wrap.style.setProperty("--legacy-gap", (st.settings.stackedTableGap || 100) + "px");
    host.appendChild(wrap);

    /* header + file picker */
    var head = document.createElement("div");
    head.className = "tablify-bar";
    var chip = document.createElement("span");
    chip.className = "filechip";
    chip.textContent = "⌗ " + doc.name;
    head.appendChild(chip);
    var meta = document.createElement("span");
    meta.className = "ob-hint";
    meta.textContent = doc.valid
      ? doc.version + " · " + doc.tables.length + " stacked table(s) · read-only"
      : doc.version + " · could not be read";
    head.appendChild(meta);
    var sp = document.createElement("span");
    sp.className = "harness-sp";
    head.appendChild(sp);
    var picker = document.createElement("div");
    picker.className = "tablify-seg";
    [["v2", "good file (v2)"], ["v1", "good file (v1)"], ["corrupt", "corrupt file"]].forEach(function (pair) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tablify-btn" + (current === pair[0] ? " is-on" : "");
      b.textContent = pair[1];
      b.addEventListener("click", function () {
        st.legacy.activeDocIndex = ids.indexOf(pair[0]);
        st.legacy.activeTableIndex = 0;
        render(host, store, ctx);
      });
      picker.appendChild(b);
    });
    head.appendChild(picker);
    wrap.appendChild(head);

    if (!doc.valid) {
      var bad = document.createElement("div");
      bad.className = "ob-banner is-warn";
      bad.textContent = "This file could not be read: " + doc.error + ". The plugin reports the problem and leaves the bytes alone — it never deletes, repairs or rewrites a .tabula file.";
      wrap.appendChild(bad);
      var raw = document.createElement("pre");
      raw.className = "dlg-preview dlg-mono";
      raw.textContent = JSON.stringify(doc.raw, null, 2);
      wrap.appendChild(raw);
      var back = document.createElement("button");
      back.type = "button";
      back.className = "ob-btn";
      back.textContent = "Open a readable file instead";
      back.addEventListener("click", function () { st.legacy.activeDocIndex = 0; render(host, store, ctx); });
      wrap.appendChild(back);
      return;
    }

    var banner = document.createElement("div");
    banner.className = "ob-banner";
    banner.textContent = "Read-only. Editing, sorting and filtering here are disabled on purpose — migrate a table to get a writable version, and keep this file as the record of what the old plugin stored.";
    wrap.appendChild(banner);

    /* the wide scrollbar above the stack, driving whichever table you are in */
    var top = document.createElement("div");
    top.className = "legacy-topscroller";
    var topSpacer = document.createElement("div");
    topSpacer.className = "legacy-topspacer";
    top.appendChild(topSpacer);
    wrap.appendChild(top);

    doc.tables.forEach(function (table, ti) {
      var rep = report(table);
      var block = document.createElement("div");
      block.className = "legacy-table";

      var bar = document.createElement("div");
      bar.className = "tablify-bar";
      var name = document.createElement("span");
      name.className = "tablify-bar-label";
      name.textContent = table.name;
      bar.appendChild(name);
      var count = document.createElement("span");
      count.className = "ob-hint";
      count.textContent = table.rows.length + " rows · " + table.fields.length + " columns";
      bar.appendChild(count);
      var sp2 = document.createElement("span");
      sp2.className = "harness-sp";
      bar.appendChild(sp2);
      var formula = document.createElement("span");
      formula.className = "filechip";
      formula.title = "The view the old plugin had stored in this file";
      formula.textContent = String(table.formula).slice(0, 40);
      bar.appendChild(formula);
      var migrate = document.createElement("button");
      migrate.type = "button";
      migrate.className = "ob-btn is-primary";
      migrate.textContent = "Migrate (dry run)…";
      migrate.addEventListener("click", function () { TF.dialogs.tabulaDryRun(ctx, doc, table); });
      bar.appendChild(migrate);
      void rep;
      block.appendChild(bar);

      var scroll = document.createElement("div");
      scroll.className = "legacy-scroll";
      var g = document.createElement("div");
      g.className = "legacy-grid";

      var headRow = document.createElement("div");
      headRow.className = "legacy-row legacy-head";
      table.fields.forEach(function (f) {
        var cell = document.createElement("div");
        cell.className = "legacy-cell is-head";
        cell.textContent = f.name;
        cell.title = COMPUTED.indexOf(f.type) !== -1
          ? "Computed (" + f.type + ") — recalculated when you migrate"
          : "Legacy type: " + (f.from || f.type);
        headRow.appendChild(cell);
      });
      g.appendChild(headRow);

      table.rows.slice(0, 12).forEach(function (row) {
        var r = document.createElement("div");
        r.className = "legacy-row";
        table.fields.forEach(function (f) {
          var cell = document.createElement("div");
          cell.className = "legacy-cell";
          var v = row.cells[f.id];
          cell.textContent = v == null ? "" : (Array.isArray(v) ? v.join(", ") : String(v));
          r.appendChild(cell);
        });
        g.appendChild(r);
      });
      if (table.rows.length > 12) {
        var more = document.createElement("div");
        more.className = "legacy-row";
        var cell2 = document.createElement("div");
        cell2.className = "legacy-cell";
        cell2.style.fontStyle = "italic";
        cell2.textContent = "… " + (table.rows.length - 12) + " more row(s), shown in full after you migrate";
        more.appendChild(cell2);
        g.appendChild(more);
      }
      scroll.appendChild(g);
      block.appendChild(scroll);

      function activate() {
        store.get().legacy.activeTableIndex = ti;
        syncTop();
      }
      block.addEventListener("mouseenter", activate);
      block.addEventListener("click", activate);
      scroll.addEventListener("scroll", function () {
        if ((store.get().legacy.activeTableIndex || 0) === ti) syncTop();
      }, { passive: true });

      wrap.appendChild(block);
    });

    function activeScroll() {
      var idx = store.get().legacy.activeTableIndex || 0;
      var nodes = wrap.querySelectorAll(".legacy-scroll");
      return nodes[Math.min(idx, nodes.length - 1)];
    }
    function syncTop() {
      var scroll = activeScroll();
      if (!scroll) return;
      if (!store.get().settings.showTopScrollbar) { top.style.display = "none"; return; }
      top.style.display = "";
      topSpacer.style.width = scroll.scrollWidth + "px";
      if (top.scrollLeft !== scroll.scrollLeft) top.scrollLeft = scroll.scrollLeft;
    }
    top.addEventListener("scroll", function () {
      var scroll = activeScroll();
      if (scroll && scroll.scrollLeft !== top.scrollLeft) scroll.scrollLeft = top.scrollLeft;
    }, { passive: true });
    if (!store.get().settings.showTopScrollbar) top.style.display = "none";
    setTimeout(syncTop, 0);

    /* migration history */
    var mig = store.get().migrations;
    if (mig.length) {
      var h = document.createElement("h4");
      h.className = "ob-field-label";
      h.textContent = "Migrations this session";
      wrap.appendChild(h);
      var list = document.createElement("div");
      list.className = "mig-list";
      mig.forEach(function (entry) {
        var item = document.createElement("div");
        item.className = "mig-item";
        item.innerHTML = "<span>" + D.esc(entry.fileName) + " · “" + D.esc(entry.tableName) + "” · " + entry.rows + " rows → notes</span>" +
          '<span class="ob-tag">source left untouched</span>';
        list.appendChild(item);
      });
      wrap.appendChild(list);
    }
  }

  return { docs: docs, docById: docById, normalize: normalize, report: report, toTable: toTable, render: render, COMPUTED: COMPUTED };
})();
