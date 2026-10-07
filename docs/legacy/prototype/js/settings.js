/* ============================================================================
   settings.js — the plugin's settings tab, rendered as Obsidian's own tab
   layout would: grouped rows, real controls, and a live "what will happen
   when you open a big file" explainer. Every control writes to the store.
   ========================================================================== */
window.TF = window.TF || {};

TF.settings = (function () {
  "use strict";
  var D = TF.data;

  function render(host, store, ctx) {
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "settings-wrap";
    var inner = document.createElement("div");
    inner.className = "settings-inner";
    wrap.appendChild(inner);
    host.appendChild(wrap);

    var st = store.get();
    var s = st.settings;

    inner.appendChild(heading("Rows & files", "Where a row lives on disk. One row is one note; the table is the front matter."));
    inner.appendChild(rowOf("Row folder", input({ value: s.newTableFolder, hint: "Vault-relative. Created if missing.", onChange: function (v) { store.updateSettings({ newTableFolder: v }); } }), "Every imported or created table gets its own folder unless you rename it."));
    inner.appendChild(rowOf("Filename template", input({ value: "{primary}.md", hint: "{primary} · {created} · {id} · {index}", onChange: function () { TF.toast.show("Template saved (prototype keeps one global value)"); } }), "Renames only affect new notes — the plugin never renames files behind your back."));
    inner.appendChild(rowOf("Row height for new views", select([["short", "Short (30)"], ["medium", "Medium (40)"], ["tall", "Tall (64)"]], s.defaultRowHeight, function (v) { store.updateSettings({ defaultRowHeight: v }); store.setView({ rowHeight: v }, "row height"); ctx.grid.render(); }), "Columns resize per view; row height is a view setting too."));

    inner.appendChild(heading("Import & export", "Nothing huge happens silently."));
    inner.appendChild(rowOf("Warn above this many rows", input({ type: "number", value: String(s.threshold), onChange: function (v) { store.updateSettings({ threshold: Math.max(10, Number(v)) }); } }), "Ask each time, every time — the plugin never remembers “don't ask” for data-destructive choices."));
    inner.appendChild(rowOf("Autosave edits", toggle(s.autosave, function (v) { store.updateSettings({ autosave: v }); }), "In the real plugin this is a write queue with retries, not a timer."));
    inner.appendChild(rowOf("Legacy .tabula behaviour", select([["keep", "Keep read-only"], ["warn", "Warn on every open"]], "keep", null), "The old files stay openable and frozen. Migration is always a dry run first."));

    inner.appendChild(heading("Sync", "One external base + table per view, behind a swappable interface. Nothing here implies any affiliation with the service it talks to."));
    inner.appendChild(rowOf("Personal access token", secret(s.tokenSet, function () {
      TF.dialogs.prompt({ title: "Personal access token", label: "Paste a token", hint: "Stored in the plugin's data.json, never in the vault or a note. The real plugin uses Obsidian's own secret storage." , confirmLabel: "Save" }).then(function (v) {
        if (!v) return;
        store.updateSettings({ tokenSet: true, token: "" });
        TF.toast.show("Token accepted (kept out of the prototype's storage)");
        render(host, store, ctx);
      });
    }), "Never displayed again after saving. No telemetry, no logging of the value."));
    inner.appendChild(rowOf("Check for changes when a view opens", toggle(s.checkOnOpen, function (v) { store.updateSettings({ checkOnOpen: v }); }), "Off by default: opening a vault should not hit the network."));

    inner.appendChild(heading("Appearance", "Theme-native: the plugin never hard-codes a colour outside its own tokens."));
    inner.appendChild(rowOf("Theme", segmented([["light", "Light"], ["dark", "Dark"]], st.ui.theme, function (v) { store.setUI({ theme: v }); ctx.applyChrome(); }), "Both themes are checked at every milestone — this toggle is the same switch the review checklist uses."));
    inner.appendChild(rowOf("Touch-sized hit targets", toggle(st.ui.touch, function (v) { store.setUI({ touch: v }); ctx.grid.render(); }), "44px cells, long-press menus, no hover-only affordances."));
    inner.appendChild(rowOf("Simulate the phone host", toggle(st.ui.phone, function (v) { store.setUI({ phone: v }); ctx.applyChrome(); }), "Squeezes the host to 389px: that is where the old plugin fell apart."));
    inner.appendChild(rowOf("Wrap the toolbar", toggle(st.ui.wrapToolbar, function (v) { store.setUI({ wrapToolbar: v }); ctx.grid.render(); }), "Overflow becomes a second row instead of hiding buttons."));

    inner.appendChild(heading("Legacy presentation", "The two knobs the old plugin exposed, kept because people relied on them."));
    inner.appendChild(rowOf("Top horizontal scrollbar", toggle(s.showTopScrollbar, function (v) { store.updateSettings({ showTopScrollbar: v }); store.setLegacy({ topScrollbar: v }); ctx.renderScreen(); }), "The wide scrollbar above stacked tables."));
    inner.appendChild(rowOf("Gap between stacked tables", slider(s.stackedTableGap, 0, 240, 20, function (v) { store.updateSettings({ stackedTableGap: Number(v) }); store.setLegacy({ stackedGap: Number(v) }); ctx.renderScreen(); }), "Kept from the old settings so muscle memory survives."));

    inner.appendChild(heading("Data", "Everything this prototype stores lives in your browser."));
    var actions = document.createElement("div");
    actions.className = "tablify-bar";
    actions.appendChild(button("Export all data (.json)", null, function () {
      TF.io.download("tablify-prototype-data.json", JSON.stringify(store.get(), function (key, value) {
        return key === "token" ? "" : value;
      }, 2), "application/json");
      TF.toast.show("Exported data — the token field is stripped");
    }));
    actions.appendChild(button("Import data (.json)", null, function () {
      var entry = document.createElement("input");
      entry.type = "file";
      entry.accept = ".json";
      entry.addEventListener("change", function () {
        var file = entry.files && entry.files[0];
        if (!file) return;
        file.text().then(function (text) {
          try {
            var parsed = JSON.parse(text);
            if (!parsed.tables || !parsed.tables.length) throw new Error("not a Tablify snapshot");
            store.commit("import data", function (state) {
              state.tables = parsed.tables;
              state.activeTableId = parsed.activeTableId || parsed.tables[0].id;
              state.view = parsed.view || store.emptyView();
            });
            TF.toast.show("Imported " + parsed.tables.length + " table(s)");
            ctx.renderScreen();
          } catch (e) {
            TF.toast.show("Could not read that file: " + e.message, "error");
          }
        });
      });
      entry.click();
    }));
    actions.appendChild(button("Reset the prototype", "danger", function () {
      TF.dialogs.confirm({
        title: "Reset everything?",
        message: "Restores the demo tables and clears the saved snapshot in this browser.",
        confirmLabel: "Reset", danger: true,
      }).then(function (ok) {
        if (!ok) return;
        store.resetTo("clean");
        ctx.renderScreen();
        TF.toast.show("Prototype reset");
      });
    }));
    inner.appendChild(actions);

    /* Advanced settings -> Content. Every switch here starts ON: the view shows
       everything it can, and narrowing it is a deliberate opt-in. */
    inner.appendChild(heading("Advanced settings", "Rarely touched switches. Everything under Content is on by default — a view starts by showing what it has."));
    inner.appendChild(subgroup("Content"));
    inner.appendChild(rowOf("Toolbar", toggle(s.showToolbar, function (v) {
      store.updateSettings({ showToolbar: v }); ctx.grid.render();
    }), "The view's own toolbar strip: search, query, filter, sort, import/export, view settings."));
    inner.appendChild(rowOf("Status bar", toggle(s.showStatusBar, function (v) {
      store.updateSettings({ showStatusBar: v }); ctx.grid.render();
    }), "Row count, selection size and the save state."));
    inner.appendChild(rowOf("Row numbers & checkboxes", toggle(st.view.rowNumbers, function (v) {
      store.updateSettings({ rowNumbers: v }); store.setView({ rowNumbers: v }, "toggle gutters"); ctx.grid.render();
    }), "The gutter content down the left edge. Applies to this view and becomes the default for new ones."));
    inner.appendChild(rowOf("Group headers", toggle(s.showGroupHeaders, function (v) {
      store.updateSettings({ showGroupHeaders: v }); ctx.grid.render();
    }), "The name and row count above each group when a view is grouped. The rows stay either way."));
    inner.appendChild(rowOf("Summary row", toggle(s.showSummaryRow, function (v) {
      store.updateSettings({ showSummaryRow: v }); ctx.grid.render();
    }), "Counts, sums and averages under the grid, one per visible column."));

    inner.appendChild(heading("About", "What this prototype is, and what it deliberately is not."));
    var about = document.createElement("div");
    about.className = "set-note";
    about.innerHTML =
      "<strong>Tablify prototype · v0.1.0-prototype</strong> · minAppVersion 1.13.0<br>" +
      "A working model of the spec in <code>docs/</code>: filters, sorts, grouping, blocks, undo, import/export, sync review and the .tabula bridge. " +
      "It runs on in-memory rows and fixture data, with no network calls, so every behaviour you see is the intended one.<br><br>" +
      "Not in here on purpose: kanban, cards, list, map and CSV export as view types — Bases already ships those. " +
      "The real plugin registers <code>registerBasesView</code> and reuses Bases for everything that is not the grid.";
    inner.appendChild(about);

    /* surface index: nothing in the prototype is hidden from the review */
    inner.appendChild(heading("Every surface in this prototype", "If a dialog is not listed here, it does not exist."));
    var surfaces = document.createElement("div");
    surfaces.className = "dlg-scroll";
    [
      "Filter builder + query string", "Sort (multi-level)", "Group by", "Hide fields",
      "View settings + presets", "Field config + type conversion", "Option manager (colours, order, usage)",
      "Cell context menu", "Column header menu", "Row/gutter menu", "Row details (the note preview)",
      "Import wizard (CSV · XLSX · clipboard · .tabula)", "Paste-block dialog", "Export dialog",
      "Sync panel (pull · push · review)", "Conflict review", ".tabula dry run", "Keyboard & touch help",
    ].forEach(function (name) {
      var line = document.createElement("div");
      line.className = "opt-row";
      line.innerHTML = '<span class="tablify-badge">●</span><span>' + name + "</span>";
      surfaces.appendChild(line);
    });
    inner.appendChild(surfaces);
  }

  /* ── tiny control builders ─────────────────────────────────────────────── */
  /* a label for a named group inside a section (Advanced settings -> Content) */
  function subgroup(title) {
    var h = document.createElement("div");
    h.className = "set-subgroup";
    h.textContent = title;
    return h;
  }

  function heading(title, sub) {
    var h = document.createElement("div");
    h.className = "set-group-title";
    h.innerHTML = D.esc(title);
    var box = document.createElement("div");
    box.className = "set-group";
    box.appendChild(h);
    if (sub) {
      var s = document.createElement("div");
      s.className = "set-note";
      s.textContent = sub;
      box.appendChild(s);
    }
    return box;
  }
  function rowOf(name, control, desc) {
    var r = document.createElement("div");
    r.className = "set-row";
    var main = document.createElement("div");
    main.className = "set-row-main";
    var n = document.createElement("div");
    n.className = "set-row-name";
    n.textContent = name;
    main.appendChild(n);
    if (desc) {
      var d = document.createElement("div");
      d.className = "set-row-desc";
      d.textContent = desc;
      main.appendChild(d);
    }
    var ctl = document.createElement("div");
    ctl.className = "set-row-ctl";
    if (control) ctl.appendChild(control);
    r.appendChild(main);
    r.appendChild(ctl);
    return r;
  }
  function input(opts) {
    var wrap = document.createElement("div");
    wrap.className = "set-inline";
    var i = document.createElement("input");
    i.className = "ob-input";
    i.type = opts.type || "text";
    i.value = opts.value;
    if (opts.hint) i.placeholder = opts.hint;
    i.addEventListener("change", function () { if (opts.onChange) opts.onChange(i.value); });
    wrap.appendChild(i);
    return wrap;
  }
  function select(options, value, onChange) {
    var s = document.createElement("select");
    s.className = "ob-input";
    options.forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0]; o.textContent = pair[1];
      if (pair[0] === value) o.selected = true;
      s.appendChild(o);
    });
    s.addEventListener("change", function () { if (onChange) onChange(s.value); });
    return s;
  }
  function toggle(value, onChange) {
    var i = document.createElement("input");
    i.type = "checkbox";
    i.className = "ob-check";
    i.checked = !!value;
    i.addEventListener("change", function () { onChange(i.checked); });
    return i;
  }
  function segmented(options, value, onChange) {
    var box = document.createElement("div");
    box.className = "tablify-seg";
    options.forEach(function (pair) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tablify-btn" + (pair[0] === value ? " is-on" : "");
      b.textContent = pair[1];
      b.addEventListener("click", function () { onChange(pair[0]); });
      box.appendChild(b);
    });
    return box;
  }
  function slider(value, min, max, step, onInput) {
    var i = document.createElement("input");
    i.type = "range";
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(value);
    i.className = "ob-input";
    i.style.maxWidth = "160px";
    i.addEventListener("input", function () { onInput(i.value); });
    return i;
  }
  function button(label, kind, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ob-btn" + (kind ? " is-" + kind : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  function secret(isSet, onClick) {
    var wrap = document.createElement("div");
    wrap.className = "set-inline";
    var badge = document.createElement("span");
    badge.className = "ob-tag";
    badge.textContent = isSet ? "set ••••••" : "not set";
    var b = button(isSet ? "Replace…" : "Add token…", null, onClick);
    wrap.appendChild(badge);
    wrap.appendChild(b);
    return wrap;
  }

  return { render: render };
})();
