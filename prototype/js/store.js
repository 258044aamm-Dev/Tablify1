/* ============================================================================
   store.js — the single source of truth for the prototype.
   · every mutation goes through commit(label, fn) → one undo step
   · undo/redo by snapshot, capped (stress mode shrinks the cap)
   · view state lives in state.view; UI chrome in state.ui (never undoable)
   · persists to localStorage so edits survive a reload
   This is the shape docs/02 describes: ops in, subscribers out, one queue.
   ========================================================================== */
window.TF = window.TF || {};

TF.store = (function () {
  "use strict";
  var D = TF.data, Q = TF.query;
  var KEY = "tablify.prototype.v3";
  var SAVE_DELAY = 260;

  function emptyView() {
    return {
      search: "", filters: { logic: "and", conditions: [] }, filtersAst: null,
      query: "", queryErrors: [],
      sorts: [], groupBy: null, collapsedGroups: [],
      hiddenFieldIds: [], columnWidths: {},
      rowHeight: "medium", frozenPrimary: true, rowNumbers: true,
    };
  }

  function initialState() {
    var table = D.sampleTable();
    var remote = D.remoteRecords(table.rows, table.fields);
    return {
      activeTableId: table.id,
      tables: [table],
      view: emptyView(),
      ui: { screen: "grid", theme: "light", themeMode: "identity", phone: false, touch: false, stress: false, wrapToolbar: false },
      presets: [],
      syncState: {
        link: null,
        remoteBase: remote.base,
        remoteTable: remote.table,
        remoteRecords: remote.records,
        snapshot: {},
        pending: null,           // computed diff awaiting review
        lastPull: null,
        lastPush: null,
        log: [],
        failNext: false,
      },
      migrations: [],
      legacy: { docs: [], topScrollbar: false, stackedGap: 100, activeDocIndex: 0 },
      settings: {
        token: "", tokenSet: false, newTableFolder: "Tablify Rows",
        defaultRowHeight: "medium", showTopScrollbar: true, stackedTableGap: 100,
        checkOnOpen: false, threshold: 250, autosave: true,
        /* Advanced settings → Content. Every content switch starts ON: the view
           shows everything it can, and narrowing it is opt-in. A default of
           "hidden" is how a plugin ends up looking like it lost your data. */
        showToolbar: true, showStatusBar: true, showGroupHeaders: true,
        showSummaryRow: true, rowNumbers: true,
      },
    };
  }

  function clone(o) {
    if (typeof structuredClone === "function") { try { return structuredClone(o); } catch (e) { void e; } }
    return JSON.parse(JSON.stringify(o));
  }

  var state = initialState();
  var history = [], future = [];
  var listeners = [];
  var saveTimer = null;

  /* ── persistence ───────────────────────────────────────────────────────── */
  function persist(immediate) {
    if (!state.settings.autosave) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        var payload = clone(state);
        payload.ui = { screen: "grid", theme: state.ui.theme, phone: state.ui.phone, touch: state.ui.touch, stress: false, wrapToolbar: false };
        localStorage.setItem(KEY, JSON.stringify(payload));
        notifySave("saved");
      } catch (e) { notifySave("error", e && e.message); }
    }, immediate ? 0 : SAVE_DELAY);
    notifySave("saving");
  }

  function notifySave(kind, msg) {
    listeners.slice().forEach(function (l) { if (l.onSave) l.onSave(kind, msg); });
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.tables || !parsed.tables.length) return false;
      var keepUI = clone(state.ui);
      state = parsed;
      state.ui = Object.assign(keepUI, { screen: parsed.ui && parsed.ui.screen ? parsed.ui.screen : "grid" });
      /* a snapshot written by an older build predates the newest settings; merge
         the defaults underneath it so a missing Content switch can never read as
         "off" and quietly blank part of the view */
      state.settings = Object.assign({}, initialState().settings, state.settings || {});
      return true;
    } catch (e) { return false; }
  }

  function resetTo(seed) {
    state = initialState();
    if (seed === "drift") {
      var drifted = D.driftLocal(state.tables[0]);
      state.tables[0] = drifted;
    }
    var remote = D.remoteRecords(state.tables[0].rows, state.tables[0].fields);
    state.syncState.remoteRecords = remote.records;
    state.syncState.remoteBase = remote.base;
    state.syncState.remoteTable = remote.table;
    history = []; future = [];
    try { localStorage.removeItem(KEY); } catch (e) { void e; }
    emit();
  }

  /* ── subscriptions ─────────────────────────────────────────────────────── */
  function on(cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (l) { return l !== cb; }); }; }
  function emit() { listeners.slice().forEach(function (l) { if (l.render) l.render(state); }); }
  function emitSaveOnly() { listeners.slice().forEach(function (l) { if (l.render) l.render(state); }); }

  /* ── the one mutation path ─────────────────────────────────────────────── */
  function cap() { return state.ui.stress ? 12 : 60; }

  function commit(label, fn) {
    var snap = clone(state);
    var res = fn(state);
    if (res === false) return false;             // mutation declined
    history.push({ label: label, state: snap });
    if (history.length > cap()) history.shift();
    future = [];
    persist(false);
    emit();
    announce(label);
    return true;
  }

  /* batch several mutations into ONE undo step */
  function transaction(label, fn) { return commit(label, fn); }

  function undo() {
    if (!history.length) { announce("Nothing to undo"); return false; }
    var entry = history.pop();
    future.push({ label: entry.label, state: clone(state) });
    state = entry.state;
    persist(false); emit(); announce("Undid " + entry.label);
    return true;
  }
  function redo() {
    if (!future.length) { announce("Nothing to redo"); return false; }
    var entry = future.pop();
    history.push({ label: entry.label, state: clone(state) });
    state = entry.state;
    persist(false); emit(); announce("Redid " + entry.label);
    return true;
  }
  function canUndo() { return history.length > 0; }
  function canRedo() { return future.length > 0; }
  function undoLabel() { return history.length ? history[history.length - 1].label : ""; }
  function redoLabel() { return future.length ? future[future.length - 1].label : ""; }

  function announce(msg) { listeners.slice().forEach(function (l) { if (l.announce) l.announce(msg); }); }

  /* ── accessors ─────────────────────────────────────────────────────────── */
  function get() { return state; }
  function table() {
    if (!state.tables.length) state.tables.push(freshTable("Tasks"));
    for (var i = 0; i < state.tables.length; i++) if (state.tables[i].id === state.activeTableId) return state.tables[i];
    /* heal a dangling id instead of rendering an empty view for ever */
    state.activeTableId = state.tables[0].id;
    return state.tables[0];
  }
  function freshTable(name) {
    var t = D.sampleTable();
    t.name = name || t.name;
    return t;
  }
  function view() { return state.view; }
  function visibleFields() {
    var t = table(), hidden = state.view.hiddenFieldIds;
    return t.fields.filter(function (f) { return hidden.indexOf(f.id) === -1; });
  }
  function viewRows() { return Q.computeView(table(), state.view); }
  function rowById(id) {
    var rows = table().rows;
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  }
  function fieldById(id) {
    var fields = table().fields;
    for (var i = 0; i < fields.length; i++) if (fields[i].id === id) return fields[i];
    return null;
  }
  function nextRowId() { return "r_" + Math.random().toString(36).slice(2, 9); }
  function nextFieldId() { return "f_" + Math.random().toString(36).slice(2, 9); }

  function blankRow() {
    var cells = {};
    table().fields.forEach(function (f) {
      var d = D.descriptor(f.type);
      if (f.type === "autoNumber") { cells[f.id] = table().autoNumberNext; table().autoNumberNext += 1; }
      else if (f.type === "createdTime" || f.type === "lastModifiedTime") cells[f.id] = new Date().toISOString();
      else cells[f.id] = D.clone(d.default);
    });
    return { id: nextRowId(), cells: cells };
  }

  function touch(row) {
    table().fields.forEach(function (f) { if (f.type === "lastModifiedTime") row.cells[f.id] = new Date().toISOString(); });
  }

  /* ── cell + row ops ────────────────────────────────────────────────────── */
  function setCell(rowId, fieldId, value) {
    return commit("edit cell", function () {
      var row = rowById(rowId), field = fieldById(fieldId);
      if (!row || !field) return false;
      row.cells[fieldId] = value;
      touch(row);
    });
  }
  function setCells(entries, label) {
    return commit(label || ("edit " + entries.length + " cell(s)"), function () {
      entries.forEach(function (e) {
        var row = rowById(e.rowId);
        if (!row) return;
        row.cells[e.fieldId] = e.value;
        touch(row);
      });
    });
  }
  function setColumnValues(fieldId, sources) {
    return commit("bulk edit column", function () {
      var field = fieldById(fieldId);
      if (!field) return false;
      sources.forEach(function (s) {
        var row = rowById(s.rowId);
        if (!row) return;
        row.cells[fieldId] = s.value;
        touch(row);
      });
    });
  }
  function addRow(atIndex, cells) {
    var created = null;
    commit("add row", function () {
      var row = cells ? { id: nextRowId(), cells: cells } : blankRow();
      var t = table();
      if (typeof atIndex === "number" && atIndex >= 0 && atIndex <= t.rows.length) t.rows.splice(atIndex, 0, row);
      else t.rows.push(row);
      created = row.id;
    });
    return created;
  }
  function insertRows(count, atIndex) {
    var ids = [];
    commit("insert " + count + " row(s)", function () {
      var t = table();
      for (var i = 0; i < count; i++) {
        var row = blankRow();
        t.rows.splice(atIndex + i, 0, row);
        ids.push(row.id);
      }
    });
    return ids;
  }
  function deleteRows(ids) {
    return commit("delete " + (ids.length === 1 ? "row" : ids.length + " rows"), function () {
      var t = table();
      t.rows = t.rows.filter(function (r) { return ids.indexOf(r.id) === -1; });
    });
  }
  function duplicateRows(ids) {
    var newIds = [];
    return commit("duplicate " + (ids.length === 1 ? "row" : ids.length + " rows"), function () {
      var t = table();
      ids.forEach(function (id) {
        var idx = -1;
        for (var i = 0; i < t.rows.length; i++) if (t.rows[i].id === id) idx = i;
        if (idx === -1) return;
        var copy = clone(t.rows[idx]);
        copy.id = nextRowId();
        Object.keys(copy.cells).forEach(function (fid) {
          var f = fieldById(fid);
          if (!f) return;
          if (f.type === "autoNumber") copy.cells[fid] = t.autoNumberNext++;
          else if (f.type === "createdTime" || f.type === "lastModifiedTime") copy.cells[fid] = new Date().toISOString();
        });
        t.rows.splice(idx + 1, 0, copy);
        newIds.push(copy.id);
      });
    }) ? newIds : [];
  }
  function moveRow(rowId, toIndex) {
    return commit("reorder rows", function () {
      var t = table(), from = -1;
      for (var i = 0; i < t.rows.length; i++) if (t.rows[i].id === rowId) from = i;
      if (from === -1 || from === toIndex) return false;
      var row = t.rows.splice(from, 1)[0];
      t.rows.splice(Math.max(0, Math.min(t.rows.length, toIndex)), 0, row);
    });
  }
  function appendRows(rowsFromImport) {
    var n = rowsFromImport.length;
    return commit("append " + n + " row(s)", function () {
      var t = table();
      rowsFromImport.forEach(function (r) {
        var cells = {};
        t.fields.forEach(function (f) {
          var v = r.cells[f.id];
          cells[f.id] = f.type === "autoNumber" ? t.autoNumberNext++ : (v === undefined ? D.clone(D.descriptor(f.type).default) : v);
        });
        t.rows.push({ id: nextRowId(), cells: cells });
      });
    });
  }
  function replaceTableCells(fields, rows) {
    return commit("replace table data", function () {
      var t = table();
      t.fields = fields;
      t.rows = rows;
      t.autoNumberNext = rows.length + 1;
      state.view = Object.assign(emptyView(), { rowHeight: state.view.rowHeight, frozenPrimary: state.view.frozenPrimary, rowNumbers: state.view.rowNumbers });
    });
  }

  /* ── field ops ─────────────────────────────────────────────────────────── */
  function defaultFieldName(type) {
    var names = { text: "Text", longText: "Notes", number: "Number", currency: "Amount", percent: "Percent", duration: "Duration", rating: "Rating", checkbox: "Done", date: "Date", datetime: "Date & time", url: "URL", email: "Email", phone: "Phone", singleSelect: "Status", multiSelect: "Tags", attachment: "Attachments", autoNumber: "Auto number", createdTime: "Created", lastModifiedTime: "Last modified" };
    return names[type] || "Field";
  }
  function makeField(type) {
    var f = { id: nextFieldId(), name: defaultFieldName(type), type: type, width: 140 };
    if (type === "singleSelect") { f.options = [{ id: "o_" + Math.random().toString(36).slice(2, 7), name: "Option A", color: "blue" }, { id: "o_" + Math.random().toString(36).slice(2, 7), name: "Option B", color: "green" }]; f.width = 150; }
    if (type === "multiSelect") { f.options = [{ id: "o_" + Math.random().toString(36).slice(2, 7), name: "Tag A", color: "purple" }, { id: "o_" + Math.random().toString(36).slice(2, 7), name: "Tag B", color: "orange" }]; f.width = 170; }
    if (type === "currency") { f.symbol = "$"; f.width = 120; }
    if (type === "rating") { f.max = 5; f.width = 120; }
    if (type === "duration") { f.unit = "seconds"; f.width = 110; }
    if (type === "percent") f.width = 140;
    if (type === "longText") f.width = 240;
    if (type === "attachment") f.width = 180;
    return f;
  }
  function addField(type, atIndex) {
    var id = null;
    commit("add field", function () {
      var t = table(), f = makeField(type);
      var idx = typeof atIndex === "number" ? atIndex : t.fields.length;
      t.fields.splice(idx, 0, f);
      t.rows.forEach(function (r) { r.cells[f.id] = f.type === "autoNumber" ? t.autoNumberNext++ : (f.type === "createdTime" || f.type === "lastModifiedTime" ? new Date().toISOString() : D.clone(D.descriptor(f.type).default)); });
      id = f.id;
    });
    return id;
  }
  function updateField(fieldId, patch) {
    return commit("edit field", function () {
      var f = fieldById(fieldId);
      if (!f) return false;
      Object.assign(f, patch);
    });
  }
  /* converting types keeps as much data as it can, and reports nothing silently */
  function convertField(fieldId, newType) {
    return commit("change field type", function () {
      var f = fieldById(fieldId);
      if (!f || f.type === newType) return false;
      var oldType = f.type;
      var t = table();
      f.type = newType;
      if (newType === "singleSelect" || newType === "multiSelect") f.options = f.options || [];
      if (newType === "rating") f.max = f.max || 5;
      if (newType === "currency") f.symbol = f.symbol || "$";
      var NUMERIC = { number: 1, currency: 1, percent: 1, duration: 1, rating: 1 };
      var bothNumeric = !!(NUMERIC[oldType] && NUMERIC[newType]);
      t.rows.forEach(function (row) {
        var v = row.cells[f.id];
        if (D.isEmptyValue(v)) { row.cells[f.id] = D.clone(D.descriptor(newType).default); return; }
        /* number → number never goes through a display string: “2:00h” used to
           turn 7200 into 200 the moment a duration became a percent */
        if (bothNumeric) {
          var n = Number(v);
          row.cells[f.id] = isNaN(n) ? D.clone(D.descriptor(newType).default) : n;
          return;
        }
        var plain = D.toPlain({ type: oldType, options: f.options }, v);
        if (newType === "singleSelect" || newType === "multiSelect") {
          f._autoCreate = true;
          row.cells[f.id] = D.fromPlain(f, plain);
          f._autoCreate = false;
        } else {
          row.cells[f.id] = D.fromPlain({ type: newType, options: f.options, unit: f.unit, max: f.max }, plain);
        }
      });
    });
  }
  function duplicateField(fieldId) {
    commit("duplicate field", function () {
      var t = table(), idx = -1;
      for (var i = 0; i < t.fields.length; i++) if (t.fields[i].id === fieldId) idx = i;
      if (idx === -1) return false;
      var copy = clone(t.fields[idx]);
      copy.id = nextFieldId();
      copy.name = copy.name + " copy";
      copy.primary = false;
      if (copy.options) copy.options = copy.options.map(function (o) { return { id: "o_" + Math.random().toString(36).slice(2, 7), name: o.name, color: o.color }; });
      t.fields.splice(idx + 1, 0, copy);
      t.rows.forEach(function (row) {
        var v = row.cells[fieldId];
        if (copy.type === "singleSelect" && v) {
          var oldOpt = t.fields[idx].options.filter(function (o) { return o.id === v; })[0];
          row.cells[copy.id] = oldOpt ? (copy.options[t.fields[idx].options.indexOf(oldOpt)] || {}).id : null;
        } else if (copy.type === "multiSelect" && Array.isArray(v)) {
          row.cells[copy.id] = v.map(function (oldId) {
            var oi = t.fields[idx].options.findIndex(function (o) { return o.id === oldId; });
            return oi === -1 ? null : copy.options[oi].id;
          }).filter(Boolean);
        } else {
          row.cells[copy.id] = Array.isArray(v) ? v.slice() : v;
        }
      });
    });
  }
  function deleteField(fieldId) {
    return commit("delete field", function () {
      var t = table();
      var f = fieldById(fieldId);
      if (!f || f.primary) return false;
      t.fields = t.fields.filter(function (x) { return x.id !== fieldId; });
      t.rows.forEach(function (row) { delete row.cells[fieldId]; });
      var i = state.view.hiddenFieldIds.indexOf(fieldId);
      if (i !== -1) state.view.hiddenFieldIds.splice(i, 1);
      state.view.sorts = state.view.sorts.filter(function (s) { return s.fieldId !== fieldId; });
      state.view.filters.conditions = state.view.filters.conditions.filter(function (c) { return c.fieldId !== fieldId; });
      state.view.filtersAst = Q.buildFromConditions(state.view.filters.logic, state.view.filters.conditions);
      if (state.view.groupBy === fieldId) state.view.groupBy = null;
    });
  }
  function moveField(fieldId, toIndex) {
    return commit("reorder columns", function () {
      var t = table(), from = -1;
      for (var i = 0; i < t.fields.length; i++) if (t.fields[i].id === fieldId) from = i;
      if (from === -1 || from === toIndex) return false;
      var f = t.fields.splice(from, 1)[0];
      t.fields.splice(Math.max(0, Math.min(t.fields.length, toIndex)), 0, f);
    });
  }
  function resizeColumn(fieldId, width) {
    return commit("resize column", function () {
      var f = fieldById(fieldId);
      if (!f) return false;
      f.width = Math.max(60, Math.round(width));
    });
  }

  /* ── select options ────────────────────────────────────────────────────── */
  function addOption(fieldId, name, color) {
    var id = null;
    commit("add option", function () {
      var f = fieldById(fieldId);
      if (!f || !f.options) return false;
      var opt = { id: "o_" + Math.random().toString(36).slice(2, 7), name: name || "New option", color: color || D.COLORS[f.options.length % D.COLORS.length] };
      f.options.push(opt);
      id = opt.id;
    });
    return id;
  }
  function updateOption(fieldId, optionId, patch) {
    return commit(patch.name != null ? "rename option" : "recolour option", function () {
      var f = fieldById(fieldId);
      if (!f || !f.options) return false;
      var o = f.options.filter(function (x) { return x.id === optionId; })[0];
      if (!o) return false;
      Object.assign(o, patch);
    });
  }
  function deleteOption(fieldId, optionId, clearCells) {
    return commit("delete option", function () {
      var f = fieldById(fieldId);
      if (!f || !f.options) return false;
      f.options = f.options.filter(function (o) { return o.id !== optionId; });
      if (clearCells) {
        table().rows.forEach(function (row) {
          var v = row.cells[fieldId];
          if (f.type === "singleSelect") { if (v === optionId) row.cells[fieldId] = null; }
          else if (Array.isArray(v)) row.cells[fieldId] = v.filter(function (x) { return x !== optionId; });
        });
      }
    });
  }
  function reorderOption(fieldId, optionId, toIndex) {
    return commit("reorder options", function () {
      var f = fieldById(fieldId);
      if (!f || !f.options) return false;
      var from = f.options.findIndex(function (o) { return o.id === optionId; });
      if (from === -1) return false;
      var o = f.options.splice(from, 1)[0];
      f.options.splice(toIndex, 0, o);
    });
  }
  function optionUsage(fieldId, optionId) {
    var n = 0, f = fieldById(fieldId);
    table().rows.forEach(function (row) {
      var v = row.cells[fieldId];
      if (f && f.type === "singleSelect") { if (v === optionId) n++; }
      else if (Array.isArray(v) && v.indexOf(optionId) !== -1) n++;
    });
    return n;
  }

  /* ── view ops ──────────────────────────────────────────────────────────── */
  function setView(patch, label) {
    return commit(label || "change view", function () { Object.assign(state.view, patch); });
  }
  function refreshAst() {
    state.view.filtersAst = Q.buildFromConditions(state.view.filters.logic, state.view.filters.conditions);
  }
  function addCondition(fieldId) {
    return commit("add filter", function () {
      var f = fieldById(fieldId) || visibleFields()[0];
      if (!f) return false;
      var op = Q.operatorsFor(f)[1] || "contains";
      state.view.filters.conditions.push({ id: "c_" + Math.random().toString(36).slice(2, 7), fieldId: f.id, op: op, value: "" });
      refreshAst();
      syncQueryText();
    });
  }
  function updateCondition(id, patch) {
    return commit("edit filter", function () {
      var c = state.view.filters.conditions.filter(function (x) { return x.id === id; })[0];
      if (!c) return false;
      Object.assign(c, patch);
      if (patch.fieldId) {
        var f = fieldById(patch.fieldId);
        var ops = Q.operatorsFor(f);
        if (ops.indexOf(c.op) === -1) c.op = ops[0];
        c.value = "";
      }
      refreshAst();
      syncQueryText();
    });
  }
  function removeCondition(id) {
    return commit("remove filter", function () {
      state.view.filters.conditions = state.view.filters.conditions.filter(function (c) { return c.id !== id; });
      refreshAst();
      syncQueryText();
    });
  }
  function setLogic(logic) {
    return commit("change filter logic", function () { state.view.filters.logic = logic; refreshAst(); syncQueryText(); });
  }
  function clearFilters() {
    return commit("clear filters", function () {
      state.view.filters = { logic: "and", conditions: [] };
      state.view.filtersAst = null;
      state.view.query = "";
      state.view.queryErrors = [];
      state.view.search = "";
    });
  }
  function syncQueryText() {
    state.view.query = state.view.filtersAst ? Q.toQueryString(state.view.filtersAst, table().fields) : "";
    state.view.queryErrors = [];
  }
  function applyQuery(text) {
    return commit("apply query", function () {
      var res = Q.parseQueryString(text, table().fields);
      state.view.query = text;
      state.view.queryErrors = res.errors;
      state.view.filtersAst = res.ast;
      /* mirror the AST back into the builder when it is a flat and/or list */
      if (res.ast && res.ast.kind === "cmp") {
        state.view.filters.logic = "and";
        state.view.filters.conditions = [fromNode(res.ast)];
      } else if (res.ast && (res.ast.kind === "and" || res.ast.kind === "or") && res.ast.children.every(function (c) { return c.kind === "cmp"; })) {
        state.view.filters.logic = res.ast.kind === "or" ? "or" : "and";
        state.view.filters.conditions = res.ast.children.map(fromNode);
      }
    });
  }
  function fromNode(node) {
    return { id: "c_" + Math.random().toString(36).slice(2, 7), fieldId: node.fieldId, op: node.op, value: node.value };
  }
  function setSearch(text) { return commit("search", function () { state.view.search = text; }); }
  function addSort(fieldId) {
    return commit("add sort", function () {
      var f = fieldById(fieldId) || visibleFields()[0];
      if (!f) return false;
      if (state.view.sorts.some(function (s) { return s.fieldId === f.id; })) return false;
      state.view.sorts.push({ id: "s_" + Math.random().toString(36).slice(2, 7), fieldId: f.id, dir: "asc" });
    });
  }
  function updateSort(id, patch) {
    return commit("change sort", function () {
      var s = state.view.sorts.filter(function (x) { return x.id === id; })[0];
      if (s) Object.assign(s, patch);
    });
  }
  function removeSort(id) { return commit("remove sort", function () { state.view.sorts = state.view.sorts.filter(function (s) { return s.id !== id; }); }); }
  function moveSort(id, delta) {
    return commit("reorder sorts", function () {
      var i = state.view.sorts.findIndex(function (s) { return s.id === id; });
      var j = i + delta;
      if (i === -1 || j < 0 || j >= state.view.sorts.length) return false;
      var tmp = state.view.sorts[i]; state.view.sorts[i] = state.view.sorts[j]; state.view.sorts[j] = tmp;
    });
  }
  function clearSorts() { return commit("clear sorts", function () { state.view.sorts = []; }); }
  function setGroupBy(fieldId) { return commit("group rows", function () { state.view.groupBy = fieldId; state.view.collapsedGroups = []; }); }
  function toggleGroupCollapse(key) {
    return commit("collapse group", function () {
      var i = state.view.collapsedGroups.indexOf(key);
      if (i === -1) state.view.collapsedGroups.push(key); else state.view.collapsedGroups.splice(i, 1);
    });
  }
  function toggleHiddenField(fieldId) {
    return commit("hide/show field", function () {
      var f = fieldById(fieldId);
      if (!f || f.primary) return false;
      var i = state.view.hiddenFieldIds.indexOf(fieldId);
      if (i === -1) state.view.hiddenFieldIds.push(fieldId); else state.view.hiddenFieldIds.splice(i, 1);
    });
  }
  function showAllFields() { return commit("show all fields", function () { state.view.hiddenFieldIds = []; }); }
  function savePreset(name) {
    return commit("save view preset", function () {
      var v = clone(state.view);
      state.presets = state.presets.filter(function (p) { return p.name !== name; });
      state.presets.push({ name: name, view: v });
    });
  }
  function applyPreset(name) {
    return commit("apply view preset", function () {
      var p = state.presets.filter(function (x) { return x.name === name; })[0];
      if (!p) return false;
      state.view = clone(p.view);
    });
  }
  function deletePreset(name) { return commit("delete view preset", function () { state.presets = state.presets.filter(function (p) { return p.name !== name; }); }); }

  /* ── UI (not undoable) ─────────────────────────────────────────────────── */
  function setUI(patch) {
    Object.assign(state.ui, patch);
    emit();
  }

  /* ── tables (legacy multi-table + new tables) ──────────────────────────── */
  function addTable(t) {
    var id = null;
    commit("add table", function () {
      var nt = t || { id: "tbl_" + Math.random().toString(36).slice(2, 7), name: "Untitled Table " + (state.tables.length + 1), fields: [{ id: nextFieldId(), name: "Name", type: "text", primary: true, width: 240 }], rows: [], autoNumberNext: 1, sync: null };
      state.tables.push(nt);
      state.activeTableId = nt.id;
      id = nt.id;
    });
    return id;
  }
  function setActiveTable(id) {
    if (!state.tables.some(function (t) { return t.id === id; })) return;
    if (state.activeTableId === id) return;
    var snap = clone(state);
    state.activeTableId = id;
    state.view = emptyView();
    history.push({ label: "switch table", state: snap });
    future = [];
    persist(false); emit();
  }
  function renameTable(id, name) { return commit("rename table", function () { var t = state.tables.filter(function (x) { return x.id === id; })[0]; if (t) t.name = name; }); }
  function dropTable(id) {
    return commit("delete table", function () {
      if (state.tables.length <= 1) return false;
      state.tables = state.tables.filter(function (t) { return t.id !== id; });
      if (state.activeTableId === id) state.activeTableId = state.tables[0].id;
    });
  }

  /* ── sync ──────────────────────────────────────────────────────────────── */
  function linkSync(link) {
    return commit("link Airtable table", function () {
      var t = table();
      t.sync = link;
      state.syncState.link = link;
      state.syncState.snapshot = {};
      state.syncState.log.push({ at: new Date().toISOString(), kind: "link", text: "Linked " + link.baseName + " / " + link.tableName });
    });
  }
  function unlinkSync() {
    return commit("unlink Airtable table", function () {
      table().sync = null;
      state.syncState.link = null;
      state.syncState.snapshot = {};
      state.syncState.pending = null;
      state.syncState.log.push({ at: new Date().toISOString(), kind: "unlink", text: "Unlinked" });
    });
  }
  function applyPull(changes) {
    return commit("pull from Airtable", function () {
      var t = table(), link = t.sync;
      if (!link) return false;
      changes.forEach(function (c) {
        if (c.kind === "new") {
          var row = { id: nextRowId(), cells: {} };
          t.fields.forEach(function (f) {
            var v = c.remote[f.id];
            row.cells[f.id] = f.type === "autoNumber" ? t.autoNumberNext++ : (v === undefined ? D.clone(D.descriptor(f.type).default) : v);
          });
          t.rows.push(row);
          link.recordMap[row.id] = c.remoteId;
        } else {
          var target = t.rows.filter(function (r) { return r.id === c.rowId; })[0];
          if (!target) return;
          Object.keys(c.fields).forEach(function (fid) { target.cells[fid] = c.fields[fid]; });
        }
      });
      state.syncState.snapshot = state.syncState.pending ? state.syncState.pending.nextSnapshot : {};
      state.syncState.pending = null;
      state.syncState.lastPull = new Date().toISOString();
      state.syncState.log.push({ at: new Date().toISOString(), kind: "pull", text: "Pulled " + changes.length + " change(s)" });
    });
  }
  function applyPush(changes) {
    return commit("push to Airtable", function () {
      var t = table(), link = t.sync;
      if (!link) return false;
      changes.forEach(function (c) {
        if (c.kind === "create") {
          var newId = "rec" + Math.random().toString(36).slice(2, 8).toUpperCase();
          link.recordMap[c.rowId] = newId;
        }
        /* always write in remote-id space: the recordMap is the only translation */
        var recId = link.recordMap[c.rowId];
        if (!recId) return;
        var rec = state.syncState.remoteRecords[recId] || { id: recId };
        Object.keys(c.fields).forEach(function (fid) { rec[fid] = c.fields[fid]; });
        state.syncState.remoteRecords[recId] = rec;
      });
      state.syncState.lastPush = new Date().toISOString();
      state.syncState.log.push({ at: new Date().toISOString(), kind: "push", text: "Pushed " + changes.length + " change(s)" });
    });
  }
  function setSyncPending(pending) { state.syncState.pending = pending; emit(); }
  function setSyncUI(patch) { Object.assign(state.syncState, patch); emit(); }

  /* ── legacy + settings + migrations ────────────────────────────────────── */
  function setLegacy(patch) { return commit("change legacy view", function () { Object.assign(state.legacy, patch); }); }
  function updateSettings(patch) { return commit("change settings", function () { Object.assign(state.settings, patch); }); }
  function recordMigration(m) {
    return commit("migrate .tabula file", function () {
      state.migrations.push(m);
      state.legacy.docs.forEach(function (d) { if (d.id === m.docId) d.migrated = true; });
    });
  }

  /* stress rows for the windowing demo */
  function addStressRows(n) {
    return commit("add " + n + " rows", function () {
      var t = table(), owners = ["Ayesha", "Rafi", "Nadia", "Ishaan"];
      for (var i = 0; i < n; i++) {
        var row = blankRow();
        row.cells.f_task = "Generated task " + t.rows.length;
        row.cells.f_status = STATUSIDS[(i * 3) % STATUSIDS.length];
        row.cells.f_owner = owners[i % owners.length];
        row.cells.f_progress = (i * 7) % 101;
        row.cells.f_conf = 1 + (i % 5);
        row.cells.f_est = 1800 * (1 + (i % 9));
        t.rows.push(row);
      }
      state.ui.stress = true;
    });
  }
  var STATUSIDS = ["s_todo", "s_prog", "s_block", "s_review", "s_done"];

  return {
    get: get, table: table, view: view, visibleFields: visibleFields, viewRows: viewRows,
    rowById: rowById, fieldById: fieldById, on: on, emit: emit, emitSaveOnly: emitSaveOnly,
    commit: commit, transaction: transaction, undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,
    undoLabel: undoLabel, redoLabel: redoLabel, announce: announce,
    setCell: setCell, setCells: setCells, setColumnValues: setColumnValues,
    addRow: addRow, insertRows: insertRows, deleteRows: deleteRows, duplicateRows: duplicateRows,
    moveRow: moveRow, appendRows: appendRows, replaceTableCells: replaceTableCells, blankRow: blankRow,
    addField: addField, updateField: updateField, convertField: convertField, duplicateField: duplicateField,
    deleteField: deleteField, moveField: moveField, resizeColumn: resizeColumn, makeField: makeField,
    addOption: addOption, updateOption: updateOption, deleteOption: deleteOption, reorderOption: reorderOption, optionUsage: optionUsage,
    setView: setView, addCondition: addCondition, updateCondition: updateCondition, removeCondition: removeCondition,
    setLogic: setLogic, clearFilters: clearFilters, applyQuery: applyQuery, setSearch: setSearch,
    addSort: addSort, updateSort: updateSort, removeSort: removeSort, moveSort: moveSort, clearSorts: clearSorts,
    setGroupBy: setGroupBy, toggleGroupCollapse: toggleGroupCollapse,
    toggleHiddenField: toggleHiddenField, showAllFields: showAllFields,
    savePreset: savePreset, applyPreset: applyPreset, deletePreset: deletePreset,
    setUI: setUI, addTable: addTable, setActiveTable: setActiveTable, renameTable: renameTable, dropTable: dropTable,
    linkSync: linkSync, unlinkSync: unlinkSync, applyPull: applyPull, applyPush: applyPush,
    setSyncPending: setSyncPending, setSyncUI: setSyncUI,
    setLegacy: setLegacy, updateSettings: updateSettings, recordMigration: recordMigration,
    addStressRows: addStressRows,
    load: load, persist: persist, resetTo: resetTo, emptyView: emptyView,
    KEY: KEY,
  };
})();
