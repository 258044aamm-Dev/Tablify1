/* ============================================================================
   harness.js — the simulated Obsidian host and the wiring.
     · every button calls the same store/view code the real plugin would
     · a surface dispatcher that can open anything, including a full tour
     · light/dark, desktop/phone squeeze, touch, stress rows, empty and
       loading states — the demo levers the review checklist asks for
   ========================================================================== */
window.TF = window.TF || {};

TF.harness = (function () {
  "use strict";
  var D = TF.data;
  var store, grid, ctx;

  var SCREENS = [
    { id: "grid", label: "Tablify grid", sub: "the plugin" },
    { id: "legacy", label: "Project plan.tabula", sub: "legacy file, read-only" },
    { id: "settings", label: "Settings", sub: "plugin tab" },
  ];

  var booted = false;
  function init() {
    if (booted) return ctx;          /* mounting twice would double every listener */
    booted = true;
    store = TF.store;

    /* ── the plugin mount point ──────────────────────────────────────────── */
    var host = document.getElementById("editor-host");
    grid = TF.grid.create(host, store, {
      onCellMenu: function (r, c, ev) { TF.dialogs.cellMenu(ctx, r, c, ev); },
      onHeaderMenu: function (field, ev) { TF.dialogs.headerMenu(ctx, field, ev); },
      onHeaderClick: function (field, ev) {
        TF.dialogs.headerMenu(ctx, field, { clientX: ev.clientX, clientY: ev.clientY });
      },
      onGutterMenu: function (index, ev) { TF.dialogs.gutterMenu(ctx, index, ev); },
      onPasteBlock: function (matrix, apply) { TF.dialogs.pasteBlockDialog(ctx, matrix, apply); },
      onPasteFiles: function (files) { importFiles(files); },
      onImport: function () { TF.dialogs.importWizard(ctx); },
      onEscape: function () { TF.menus.close(); grid.closePopovers(); },
    });
    ctx = { store: store, grid: grid, renderScreen: renderScreen, applyChrome: applyChrome };

    /* ── store subscriptions ─────────────────────────────────────────────── */
    store.on({
      render: function (state) {
        grid.render();
        if (state.ui.screen === "legacy") renderScreen();
        if (state.ui.screen === "settings") renderToolbarBadges();
        renderBasesBar();
        applyChrome();
      },
      announce: function (msg) {
        var live = document.getElementById("live");
        if (live) live.textContent = msg;
        TF.toast.show(msg);
      },
      onSave: function (kind, message) {
        grid.onSave(kind, message);
        var live = document.getElementById("live");
        if (live && kind === "error") live.textContent = "Save failed: " + (message || "");
      },
    });

    /* try to restore the last session, else fresh demo data */
    var restored = store.load();
    if (!restored) store.persist(true);

    buildHarnessBar();
    buildTabstrip();
    buildToolbar();
    wireGlobalKeys();
    renderScreen();
    grid.render();
    renderBasesBar();
    applyChrome();

    if (restored) TF.toast.show("Restored your last session");
    return ctx;
  }

  /* ── harness bar (outside the simulated app) ───────────────────────────── */
  function buildHarnessBar() {
    var screens = document.getElementById("harness-screens");
    var host = document.getElementById("harness-host");
    var theme = document.getElementById("harness-theme");
    var surfaces = document.getElementById("harness-surfaces");
    var demo = document.getElementById("harness-demo");

    group(screens, "Screen");
    SCREENS.forEach(function (s) {
      var b = hbtn(s.label, function () {
        store.get().legacy.activeDocIndex = store.get().legacy.activeDocIndex || 0;
        store.setUI({ screen: s.id });
        store.get().legacy.activeTableIndex = 0;
        renderScreen();
        grid.render();
      });
      b.dataset.screen = s.id;
      b.title = s.sub;
      screens.appendChild(b);
    });

    group(host, "Host width");
    var desk = hbtn("Desktop", function () { setHost(false); });
    var phone = hbtn("Phone 389px", function () { setHost(true); });
    desk.dataset.host = "desktop";
    desk.title = "The host the old plugin broke in";
    phone.dataset.host = "phone";
    host.appendChild(desk);
    host.appendChild(phone);

    group(theme, "Theme");
    var light = hbtn("Light", function () { setTheme("light"); });
    var dark = hbtn("Dark", function () { setTheme("dark"); });
    light.dataset.theme = "light";
    dark.dataset.theme = "dark";
    theme.appendChild(light);
    theme.appendChild(dark);
    var hostTheme = hbtn("Follow my Obsidian theme", function () {
      setThemeMode(store.get().ui.themeMode === "host" ? "identity" : "host");
    });
    hostTheme.dataset.themeMode = "host";
    hostTheme.title = "Tablify's own palette, or the host theme's colours";
    theme.appendChild(hostTheme);

    group(surfaces, "Surfaces");
    surfaces.appendChild(hbtn("Every surface ▾", function (ev) { TF.menus.fromEvent(surfaceItems(), ev); }));
    surfaces.appendChild(hbtn("Tour all", function () { tour(); }));

    group(demo, "Demo data");
    demo.appendChild(hbtn("Rows +400", function () { store.addStressRows(400); TF.toast.show("Added 400 rows"); }));
    demo.appendChild(hbtn("Perf: 5,000 rows", function () {
      var have = store.table().rows.length;
      if (have < 5000) store.addStressRows(5000 - have);
      TF.toast.show(store.table().rows.length.toLocaleString() + " rows — still windowed");
    }));
    demo.appendChild(hbtn("Sync drift", function () {
      TF.sync.seedDemo(store);
      store.emit();
      TF.dialogs.syncPanel(ctx);
    }));
    demo.appendChild(hbtn("Reset", function () { store.resetTo("clean"); renderScreen(); TF.toast.show("Reset to the demo table"); }));
  }
  function group(bar, label) {
    var l = document.createElement("span");
    l.className = "harness-label";
    l.textContent = label;
    bar.appendChild(l);
  }
  function hbtn(label, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "harness-btn";
    b.textContent = label;
    b.addEventListener("click", function (ev) { onClick(ev); });
    return b;
  }

  function setHost(phone) {
    store.setUI({ phone: phone });
  }
  function setTheme(t) {
    store.setUI({ theme: t });
  }
  function setThemeMode(mode) {
    store.setUI({ themeMode: mode === "host" ? "host" : "identity" });
  }

  /* every dialog surface, resolvable — nothing in the build is unreachable */
  function surfaceItems() {
    var activeRowId = (grid.getSelection().rows[0] || {}).id;
    return [
      { section: "View surfaces" },
      { label: "Filter builder + query string", onClick: function () { TF.dialogs.filterPanel(ctx); } },
      { label: "Sort (multi-level)", onClick: function () { TF.dialogs.sortPanel(ctx); } },
      { label: "Group by", onClick: function () { TF.dialogs.groupPanel(ctx); } },
      { label: "Hide fields", onClick: function () { TF.dialogs.hidePanel(ctx); } },
      { label: "View settings + presets", onClick: function () { TF.dialogs.viewPanel(ctx); } },
      { label: "Add field", onClick: function () { addFieldDialog(); } },
      { sep: true },
      { section: "Structure surfaces" },
      { label: "Field config + type conversion", onClick: function () {
        var f = store.visibleFields()[1] || store.visibleFields()[0];
        if (f) TF.dialogs.fieldConfig(ctx, f.id);
      } },
      { label: "Option manager", onClick: function () {
        var f = store.table().fields.filter(function (x) { return x.options; })[0];
        if (f) TF.dialogs.optionManager(ctx, f.id);
        else TF.dialogs.fieldConfig(ctx, (store.table().fields[0] || {}).id);
      } },
      { label: "Row details (note preview)", onClick: function () { if (activeRowId) TF.dialogs.rowDetails(ctx, activeRowId); } },
      { label: "Cell context menu", onClick: function () { TF.menus.open(cellMenuItemsProxy(), 60, 140); } },
      { label: "Column header menu", onClick: function () {
        var f = store.visibleFields()[1] || store.visibleFields()[0];
        if (f) TF.dialogs.headerMenu(ctx, f, { clientX: 220, clientY: 170 });
      } },
      { label: "Row / gutter menu", onClick: function () { TF.dialogs.gutterMenu(ctx, 0, { clientX: 120, clientY: 160 }); } },
      { sep: true },
      { section: "Data surfaces" },
      { label: "Import wizard (CSV · XLSX · clipboard · .tabula)", onClick: function () { TF.dialogs.importWizard(ctx); } },
      { label: "Paste-block dialog", onClick: function () {
        var matrix = TF.io.parseCSV(D.SAMPLE_CSV);
        TF.io.copyText(TF.io.toTSV(matrix));
        TF.dialogs.pasteBlockDialog(ctx, matrix, function (mode) {
          TF.toast.show("Paste mode: " + mode);
        });
      } },
      { label: "Export dialog", onClick: function () { TF.dialogs.exportDialog(ctx); } },
      { label: "Sync panel (pull · push · review)", onClick: function () { TF.dialogs.syncPanel(ctx); } },
      { label: ".tabula dry run", onClick: function () {
        var v1 = TF.legacy.docById("v1");
        TF.dialogs.tabulaDryRun(ctx, v1, v1.tables[0]);
      } },
      { label: "Keyboard & touch help", onClick: function () { TF.dialogs.keyboardHelp(); } },
      { sep: true },
      { label: "Everything above opens a real dialog — the .tabula screen and Settings live in the harness Screen group.", disabled: true },
    ];
  }
  function cellMenuItemsProxy() {
    var items = [];
    var surfaces = surfaceItems();
    void surfaces;
    items.push({ label: "Open the cell menu from a real cell", disabled: true });
    items.push({ label: "Right-click any cell to get the full menu", onClick: function () { TF.toast.show("Right-click (or long-press) a cell"); } });
    return items;
  }

  function tour() {
    var steps = [
      function () { TF.dialogs.filterPanel(ctx); },
      function () { TF.dialogs.sortPanel(ctx); },
      function () { TF.dialogs.groupPanel(ctx); },
      function () { TF.dialogs.hidePanel(ctx); },
      function () { TF.dialogs.viewPanel(ctx); },
      function () { TF.dialogs.fieldConfig(ctx, store.visibleFields()[1].id); },
      function () {
        var f = store.table().fields.filter(function (x) { return x.options; })[0];
        TF.dialogs.optionManager(ctx, f.id);
      },
      function () { TF.dialogs.rowDetails(ctx, (grid.getSelection().rows[0] || {}).id); },
      function () { TF.dialogs.importWizard(ctx); },
      function () { TF.dialogs.exportDialog(ctx); },
      function () { TF.dialogs.keyboardHelp(); },
    ];
    TF.toast.show("Touring " + steps.length + " surfaces — press Esc to stop");
    var i = 0;
    (function next() {
      if (i >= steps.length) { TF.toast.show("That is every modal surface"); return; }
      var overlays = document.querySelectorAll(".modal-overlay");
      Array.prototype.forEach.call(overlays, function (o) { o.remove(); });
      steps[i++]();
      setTimeout(next, 1300);
    })();
  }

  /* ── the app window's tabstrip ─────────────────────────────────────────── */
  function buildTabstrip() {
    var strip = document.getElementById("tabstrip");
    strip.innerHTML = "";
    SCREENS.forEach(function (s) {
      var tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab";
      tab.dataset.screen = s.id;
      tab.innerHTML = '<span class="tab-dot"></span><span>' + D.esc(s.label) + '</span><span class="tab-close" title="' + D.esc(s.sub) + '">·</span>';
      tab.addEventListener("click", function () {
        store.setUI({ screen: s.id });
        renderScreen();
        grid.render();
      });
      strip.appendChild(tab);
    });
  }

  /* ── the plugin's own top bar (Bases host chrome) ──────────────────────── */
  function renderBasesBar() {
    var bar = document.getElementById("bases-bar");
    if (!bar) return;
    var t = store.table();
    var shown = store.viewRows().length;
    bar.innerHTML = "";
    var pill = document.createElement("span");
    pill.className = "view-pill";
    pill.textContent = "Tablify";
    bar.appendChild(pill);
    var name = document.createElement("span");
    name.textContent = t.name;
    bar.appendChild(name);
    var meta = document.createElement("span");
    meta.textContent = shown + " of " + t.rows.length + " rows" + (t.sync ? " · linked" : "");
    bar.appendChild(meta);
    var sp = document.createElement("span");
    sp.className = "harness-sp";
    bar.appendChild(sp);
    var note = document.createElement("span");
    note.textContent = "Bases view · " + (store.view().groupBy ? "grouped" : "flat") + " · " +
      (store.view().sorts.length ? store.view().sorts.length + " sort(s)" : "unsorted");
    bar.appendChild(note);
  }

  /* ── the plugin toolbar ────────────────────────────────────────────────── */
  function buildToolbar() {
    var bar = grid.els.toolbar;
    bar.innerHTML = "";

    /* table switcher first: several tables can live in one vault */
    var tableBtn = tbtn(store.table().name + " ▾", "Table and its fields", function (ev) {
      var items = [{ section: "Tables" }];
      store.get().tables.forEach(function (t) {
        items.push({
          label: t.name,
          checked: t.id === store.get().activeTableId,
          onClick: function () { store.setActiveTable(t.id); grid.render(); renderBasesBar(); },
        });
      });
      items.push({ sep: true });
      items.push({ label: "New table", onClick: function () { store.addTable(); grid.render(); renderBasesBar(); } });
      items.push({ label: "Rename this table…", onClick: function () {
        TF.dialogs.prompt({ title: "Rename table", label: "Table name", value: store.table().name }).then(function (v) {
          if (v) { store.renameTable(store.table().id, v); renderBasesBar(); grid.render(); }
        });
      } });
      items.push({ label: "Duplicate fields only", onClick: function () {
        store.addTable({
          id: "tbl_" + Math.random().toString(36).slice(2, 7),
          name: store.table().name + " (copy)",
          fields: D.clone(store.table().fields).map(function (f) { f.id = "f_" + Math.random().toString(36).slice(2, 7); return f; }),
          rows: [], autoNumberNext: 1, sync: null,
        });
        grid.render();
      } });
      items.push({ sep: true });
      items.push({ label: "Delete this table", danger: true, disabled: store.get().tables.length <= 1, onClick: function () {
        TF.dialogs.confirm({ title: "Delete table?", message: "Deletes “" + store.table().name + "” from this view.", confirmLabel: "Delete", danger: true }).then(function (ok) {
          if (!ok) return;
          store.dropTable(store.table().id);
          grid.render(); renderBasesBar();
        });
      } });
      TF.menus.fromEvent(items, ev);
    });
    tableBtn.classList.add("is-primary-soft");
    bar.appendChild(tableBtn);

    bar.appendChild(divider());

    /* search */
    var searchWrap = document.createElement("div");
    searchWrap.className = "tablify-search";
    var search = document.createElement("input");
    search.className = "ob-input";
    search.placeholder = "Search rows…";
    search.value = store.view().search;
    search.setAttribute("aria-label", "Search rows");
    var searchTimer = null;
    search.addEventListener("input", function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        store.setSearch(search.value);   /* 250 ms — the debounce in the budget */
        grid.render();
      }, 250);
    });
    search.addEventListener("keydown", function (e) { if (e.key === "Escape") { search.value = ""; store.setSearch(""); grid.render(); } });
    searchWrap.appendChild(search);
    bar.appendChild(searchWrap);

    /* query-string DSL: first class, not hidden behind a menu */
    var query = document.createElement("input");
    query.className = "tablify-query" + (store.view().queryErrors.length ? " is-error" : "");
    query.placeholder = 'status:~done and budget>1000 or empty(due)';
    query.value = store.view().query;
    query.title = "Query string: field:value, field:>100, field:!x, field:a,b, field:empty, quoted \"Field name\":value; whitespace is AND, “or” is OR";
    query.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        store.applyQuery(query.value);
        query.className = "tablify-query" + (store.view().queryErrors.length ? " is-error" : "");
        grid.render();
      }
    });
    query.addEventListener("blur", function () {
      query.value = store.view().query;
      query.className = "tablify-query" + (store.view().queryErrors.length ? " is-error" : "");
    });
    bar.appendChild(query);

    bar.appendChild(divider());

    var view = store.view();
    bar.appendChild(badgeBtn("Filter", view.filters.conditions.length || (view.filtersAst ? 1 : 0), function () { TF.dialogs.filterPanel(ctx); }));
    bar.appendChild(badgeBtn("Sort", view.sorts.length, function () { TF.dialogs.sortPanel(ctx); }));
    bar.appendChild(badgeBtn("Group", view.groupBy ? 1 : 0, function () { TF.dialogs.groupPanel(ctx); }));
    bar.appendChild(badgeBtn("Fields", view.hiddenFieldIds.length, function () { TF.dialogs.hidePanel(ctx); }, view.hiddenFieldIds.length ? "hidden" : null));

    bar.appendChild(divider());

    bar.appendChild(tbtn("Import", "CSV, XLSX, clipboard or .tabula (dry run)", function () { TF.dialogs.importWizard(ctx); }));
    bar.appendChild(tbtn("Export", "CSV, TSV, XLSX, Markdown or JSON", function () { TF.dialogs.exportDialog(ctx); }));

    var syncPending = store.get().syncState.pending;
    var syncBtn = tbtn("Sync" + (syncPending && syncPending.stats.conflicts ? " ⚠" + syncPending.stats.conflicts : ""), "Pull, push and review changes", function () { TF.dialogs.syncPanel(ctx); });
    if (store.table().sync) syncBtn.style.borderColor = "var(--tablify-accent)";
    bar.appendChild(syncBtn);

    bar.appendChild(divider());

    bar.appendChild(tbtn("＋ Field", "Add a field", function () { addFieldDialog(); }));
    bar.appendChild(tbtn("View", "Row height, frozen column, presets", function () { TF.dialogs.viewPanel(ctx); }));

    var sp = document.createElement("span");
    sp.className = "harness-sp";
    bar.appendChild(sp);

    /* undo / redo with live labels */
    var undo = tbtn("↶ Undo", store.canUndo() ? "Undo " + store.undoLabel() : "Nothing to undo", function () { store.undo(); grid.render(); });
    undo.disabled = !store.canUndo();
    var redo = tbtn("↷ Redo", store.canRedo() ? "Redo " + store.redoLabel() : "Nothing to redo", function () { store.redo(); grid.render(); });
    redo.disabled = !store.canRedo();
    undo.classList.add("is-ghost");
    redo.classList.add("is-ghost");
    bar.appendChild(undo);
    bar.appendChild(redo);

    var more = tbtn("⋯", "More", function (ev) { TF.menus.fromEvent(moreItems(), ev); });
    more.classList.add("is-ghost");
    bar.appendChild(more);

    bar.classList.toggle("is-wrapped", !!store.get().ui.wrapToolbar);
  }

  function moreItems() {
    var view = store.view();
    return [
      { section: "Row height" },
      { label: "Short (30)", checked: view.rowHeight === "short", onClick: function () { store.setView({ rowHeight: "short" }, "row height"); grid.render(); } },
      { label: "Medium (40)", checked: view.rowHeight === "medium", onClick: function () { store.setView({ rowHeight: "medium" }, "row height"); grid.render(); } },
      { label: "Tall (64)", checked: view.rowHeight === "tall", onClick: function () { store.setView({ rowHeight: "tall" }, "row height"); grid.render(); } },
      { sep: true },
      { label: "Freeze the primary column", hide: grid.isNarrow && grid.isNarrow(), checked: !!view.frozenPrimary, onClick: function () { store.setView({ frozenPrimary: !view.frozenPrimary }, "frozen column"); grid.render(); } },
      { label: "Row checkboxes + numbering", checked: !!view.rowNumbers, onClick: function () { store.setView({ rowNumbers: !view.rowNumbers }, "gutters"); grid.render(); } },
      { label: "Wrap the toolbar", checked: !!store.get().ui.wrapToolbar, onClick: function () { store.setUI({ wrapToolbar: !store.get().ui.wrapToolbar }); buildToolbar(); } },
      { sep: true },
      { label: "Save the current view as a preset…", onClick: function () {
        TF.dialogs.prompt({ title: "Save view preset", label: "Preset name", value: "Preset " + (store.get().presets.length + 1) }).then(function (name) {
          if (name) { store.savePreset(name); TF.toast.show("Saved preset “" + name + "”"); }
        });
      } },
      { label: "Clear filter, sort, grouping and search", onClick: function () {
        store.transaction("clear the whole view", function (s) {
          s.view.filters = { logic: "and", conditions: [] };
          s.view.filtersAst = null; s.view.query = ""; s.view.queryErrors = [];
          s.view.sorts = []; s.view.groupBy = null; s.view.collapsedGroups = []; s.view.search = "";
        });
        buildToolbar(); grid.render();
      } },
      { sep: true },
      { label: "Keyboard & touch help", key: "F1", onClick: function () { TF.dialogs.keyboardHelp(); } },
      { label: "Show a loading state", onClick: function () { simulateLoad(); } },
      { label: "Show the empty state", onClick: function () { showEmptyState(); } },
      { label: "Open the settings tab", onClick: function () { store.setUI({ screen: "settings" }); renderScreen(); } },
      { sep: true },
      { label: "Add 5,000 rows (performance demo)", onClick: function () {
        var have = store.table().rows.length;
        if (have < 5000) store.addStressRows(5000 - have);
        simulateLoad();
        grid.render();
      } },
      { label: "Add 400 rows", onClick: function () { store.addStressRows(400); grid.render(); } },
      { label: "Seed sync drift + conflicts", onClick: function () { TF.sync.seedDemo(store); store.emit(); TF.dialogs.syncPanel(ctx); } },
      { sep: true },
      { label: "About this prototype", onClick: function () { store.setUI({ screen: "settings" }); renderScreen(); } },
      { label: "Reset to the demo table", danger: true, onClick: function () { store.resetTo("clean"); renderScreen(); } },
    ];
  }

  function addFieldDialog() {
    TF.dialogs.modal({
      title: "Add field",
      wide: true,
      subtitle: "19 field types, including the computed ones from the old plugin.",
      body: function (body, m) {
        var box = document.createElement("div");
        box.className = "dlg-choices";
        D.TYPE_ORDER.forEach(function (t) {
          var d = D.TYPES[t];
          var b = document.createElement("button");
          b.type = "button";
          b.className = "dlg-choice";
          b.innerHTML = '<span class="dlg-choice-name">' + d.icon + " " + D.esc(d.label) + "</span>" +
            '<span class="dlg-choice-desc">' + (d.editable ? "Editable" : "Computed — read-only cells") + "</span>";
          b.addEventListener("click", function () {
            var id = store.addField(t);
            m.close();
            grid.render();
            TF.dialogs.fieldConfig(ctx, id);
          });
          box.appendChild(b);
        });
        body.appendChild(box);
      },
    });
  }

  function tbtn(label, title, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tablify-btn";
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener("click", function (ev) { onClick(ev); });
    return b;
  }
  function badgeBtn(label, count, onClick, suffix) {
    var b = tbtn(label, null, onClick);
    if (count) {
      var badge = document.createElement("span");
      badge.className = "tablify-badge";
      badge.textContent = count;
      b.appendChild(badge);
    } else if (suffix) {
      b.classList.add("is-on");
      b.title = suffix;
    }
    return b;
  }
  function divider() {
    var d = document.createElement("span");
    d.className = "tablify-drag";
    d.style.width = "1px";
    d.style.height = "18px";
    d.style.background = "var(--background-modifier-border)";
    return d;
  }
  function renderToolbarBadges() { buildToolbar(); }

  /* ── demo states ───────────────────────────────────────────────────────── */
  function simulateLoad() {
    var lane = grid.els.rows;
    if (!lane) return;
    var veil = document.createElement("div");
    veil.style.cssText = "position:absolute;inset:0;background:var(--background-primary);z-index:5;padding:12px;display:flex;flex-direction:column;gap:10px";
    for (var i = 0; i < 8; i++) {
      var bar = document.createElement("div");
      bar.className = "skeleton";
      bar.style.height = grid.rowHeight() - 8 + "px";
      bar.innerHTML = '<span class="skeleton-bar" style="width:' + (20 + ((i * 13) % 55)) + '%"></span>';
      veil.appendChild(bar);
    }
    lane.parentElement.appendChild(veil);
    setTimeout(function () { veil.remove(); }, 700);
  }
  function showEmptyState() {
    store.transaction("hide every row", function (s) {
      s.previewHiddenRows = s.tables[0].rows.slice();
      s.tables[0].rows = [];
    });
    grid.render();
    TF.toast.show("Undo (Ctrl+Z) brings every row back");
  }

  /* ── screen routing ────────────────────────────────────────────────────── */
  function renderScreen() {
    var screen = store.get().ui.screen;
    Array.prototype.forEach.call(document.querySelectorAll(".screen"), function (node) {
      node.classList.toggle("is-active", node.id === "screen-" + screen);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (node) {
      node.classList.toggle("is-active", node.dataset.screen === screen);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-screen]"), function (node) {
      if (node.classList.contains("harness-btn")) node.classList.toggle("is-on", node.dataset.screen === screen);
    });
    if (screen === "legacy") TF.legacy.render(document.getElementById("legacy-host"), store, ctx);
    if (screen === "settings") TF.settings.render(document.getElementById("settings-host"), store, ctx);
  }

  function applyChrome() {
    var ui = store.get().ui;
    var win = document.getElementById("window");
    var ws = document.getElementById("workspace");
    if (win) win.classList.toggle("theme-dark", ui.theme === "dark");
    /* dialogs, menus, popovers and toasts are portalled OUTSIDE #window, so the
       theme has to land on <html> too; data-tablify-theme is the identity/host
       switch that css/tokens.css reads. */
    var html = document.documentElement;
    html.classList.toggle("theme-dark", ui.theme === "dark");
    html.setAttribute("data-tablify-theme", ui.themeMode === "host" ? "host" : "identity");
    Array.prototype.forEach.call(document.querySelectorAll("[data-theme-mode]"), function (n) {
      if (n.classList.contains("harness-btn")) {
        n.classList.toggle("is-on", n.dataset.themeMode === (ui.themeMode === "host" ? "host" : "identity"));
      }
    });
    if (ws) ws.classList.toggle("is-phone", !!ui.phone);
    Array.prototype.forEach.call(document.querySelectorAll("[data-theme]"), function (n) {
      if (n.classList.contains("harness-btn")) n.classList.toggle("is-on", n.dataset.theme === ui.theme);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-host]"), function (n) {
      if (n.classList.contains("harness-btn")) n.classList.toggle("is-on", (n.dataset.host === "phone") === !!ui.phone);
    });
    var root = grid && grid.root;
    if (root) root.classList.toggle("is-touch", !!ui.touch);
  }

  /* files dropped or pasted into the grid */
  function importFiles(files) {
    var file = files[0];
    if (!file) return;
    var ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "csv" || ext === "tsv" || ext === "txt") {
      file.text().then(function (text) {
        var matrix = ext === "tsv" ? TF.io.parseTSV(text) : TF.io.parseCSV(text);
        TF.dialogs.importWizard(ctx, { matrix: matrix, fileName: file.name });
      });
      return;
    }
    if (ext === "xlsx" || ext === "ods") {
      TF.dialogs.readSpreadsheet(file).then(function (matrix) {
        if (!matrix) { TF.toast.show("Could not decode " + file.name, "error"); return; }
        TF.dialogs.importWizard(ctx, { matrix: matrix, fileName: file.name });
      });
      return;
    }
    if (ext === "json") {
      file.text().then(function (text) {
        try {
          var data = JSON.parse(text);
          if (data && (data.tables || data.fields)) {
            var normalized = TF.legacy.normalize(data, "imported", file.name);
            if (!normalized.valid) { TF.toast.show("Read it, but it has problems: " + normalized.error, "error"); }
            else TF.toast.show("Parsed " + file.name + " read-only — migrate from the legacy screen");
            store.commit("read a .tabula file", function (s) {
              s.importedLegacy = normalized;
              s.legacy.activeDocIndex = 0;
            });
            store.setUI({ screen: "legacy" });
            renderScreen();
          } else {
            TF.toast.show("That JSON is not a .tabula file", "error");
          }
        } catch (e) { TF.toast.show("Unreadable JSON: " + e.message, "error"); }
      });
      return;
    }
    TF.toast.show("Unsupported file type: ." + ext, "error");
  }

  /* ── global keys (grid handles its own while focused) ──────────────────── */
  function wireGlobalKeys() {
    document.addEventListener("keydown", function (e) {
      var insideGrid = e.target && e.target.closest && e.target.closest(".tablify-root");
      var typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT");
      var meta = e.metaKey || e.ctrlKey;
      if (e.key === "F1" || (e.key === "?" && !typing)) { e.preventDefault(); TF.dialogs.keyboardHelp(); return; }
      if (typing) return;
      if (insideGrid) return;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); store.undo(); return; }
      if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); store.redo(); return; }
      if (meta && e.key.toLowerCase() === "f") { e.preventDefault(); TF.dialogs.filterPanel(ctx); return; }
      if (meta && e.key.toLowerCase() === "s") { e.preventDefault(); store.persist(true); TF.toast.show("View state saved"); return; }
      if (e.key === "1") { store.setUI({ screen: "grid" }); renderScreen(); }
      if (e.key === "2") { store.setUI({ screen: "legacy" }); renderScreen(); }
      if (e.key === "3") { store.setUI({ screen: "settings" }); renderScreen(); }
    });
  }

  return { init: init, ctx: function () { return ctx; } };
})();

document.addEventListener("DOMContentLoaded", function () { TF.harness.init(); });
