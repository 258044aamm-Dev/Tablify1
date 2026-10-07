/* ============================================================================
   dialogs.js — menus, the modal shell, and every dialog surface:
     filter builder · sort · group by · hide fields · query DSL · field config ·
     option manager · view/presets · import wizard · export · sync + conflicts ·
     paste-block · .tabula dry run · keyboard help · toasts
   Everything here is real: filters filter, sorts stack, exports produce files.
   ========================================================================== */
window.TF = window.TF || {};

/* ── motion ─────────────────────────────────────────────────────────────────
   The transitions themselves live in CSS (see css/tokens.css + the motion
   section of css/tablify.css). JS needs the same answer for one thing only:
   an exit that is being animated must not delay the element's removal, and on
   a machine that asked for reduced motion there is no exit to play. */
TF.motion = {
  reduced: function () {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  },
};

TF.menus = (function () {
  "use strict";
  var D = TF.data;
  var open = null;
  var opener = null;

  /* Closing a menu must not strand the keyboard. Whatever held focus when the
     menu opened gets it back — for a click on a toolbar button that is the
     button itself, and for a right-click inside the grid it is the grid root,
     which is exactly what the grid already hands focus back to. The restore is
     deferred so it wins over the grid's synchronous handFocusBack() (the
     browser parks focus on <body> while the node is removed). */
  function close(restoreFocus) {
    var trigger = opener;
    open = null;
    opener = null;
    Array.prototype.forEach.call(document.querySelectorAll(".menu"), function (n) { n.remove(); });
    if (restoreFocus === false || !trigger) return;
    if (!document.contains(trigger) || (trigger.closest && trigger.closest(".menu"))) return;
    setTimeout(function () {
      /* Only hand focus back if it was actually lost — if the menu item opened a
         dialog, or the user clicked into an input, that surface owns focus now
         and pulling it back to the trigger would be worse than leaving it. */
      if (document.querySelector(".modal-overlay:not(.is-closing)")) return;
      var ae = document.activeElement;
      /* focus is "parked" on <body> while the node is removed, still inside the
         menu we just closed, or already handed to the grid root by the grid's
         own handFocusBack() — in all three cases the opener is the right place
         for it. Anything else means a surface the user chose owns focus now. */
      var parked = !ae || ae === document.body || ae === document.documentElement ||
        (ae.closest && ae.closest(".menu")) || (ae.classList && ae.classList.contains("tablify-root"));
      if (!parked || !document.contains(trigger)) return;
      try { trigger.focus({ preventScroll: true }); } catch (e) { trigger.focus(); }
    }, 0);
  }

  function build(items, parent) {
    var menu = document.createElement("div");
    menu.className = "menu";
    items.forEach(function (it) {
      if (it.sep) { menu.appendChild(document.createElement("div")).className = "menu-sep"; return; }
      /* a section heading uses `section`, never `label`: `label` is the item's
         own text, and treating a truthy label as a heading silently turned every
         menu entry in the app into a non-clickable heading. */
      if (it.section) { var l = document.createElement("div"); l.className = "menu-label"; l.textContent = it.section; menu.appendChild(l); return; }
      /* `hide` is for an entry that cannot apply at this size (freezing the primary
         column in a narrow pane): absent, not greyed out */
      if (it.hide) return;
      var node = document.createElement("button");
      node.className = "menu-item" + (it.danger ? " is-danger" : "") + (it.disabled ? " is-disabled" : "");
      node.type = "button";
      node.innerHTML =
        '<span class="menu-item-name">' + D.esc(it.label) + (it.submenu ? ' <span class="menu-key">▸</span>' : "") + "</span>" +
        (it.checked ? '<span class="menu-key">✓</span>' : (it.key ? '<span class="menu-key">' + D.esc(it.key) + "</span>" : ""));
      if (it.disabled) { node.disabled = true; menu.appendChild(node); return; }
      node.addEventListener("click", function (e) {
        e.stopPropagation();
        if (it.submenu) { return; }
        close();
        if (it.onClick) it.onClick();
      });
      if (it.submenu) {
        var sub = null;
        node.addEventListener("mouseenter", function () {
          if (sub) return;
          sub = build(it.submenu, menu);
          document.body.appendChild(sub);
          var r = node.getBoundingClientRect();
          sub.style.left = (r.right + 4) + "px";
          sub.style.top = r.top + "px";
        });
      }
      menu.appendChild(node);
    });
    return menu;
  }

  function openAt(items, x, y) {
    close(false);
    var ae = document.activeElement;
    opener = (ae && ae !== document.body && ae !== document.documentElement) ? ae : null;
    var menu = build(items, null);
    document.body.appendChild(menu);
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 10)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 10)) + "px";
    open = menu;
    return menu;
  }
  function fromEvent(items, ev) { return openAt(items, ev.clientX, ev.clientY); }

  document.addEventListener("mousedown", function (e) {
    if (!open) return;
    if (e.target.closest && e.target.closest(".menu")) return;
    /* a click somewhere else is already moving focus where the user aimed it */
    close(false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  window.addEventListener("resize", close);

  return { open: openAt, fromEvent: fromEvent, close: close };
})();

TF.toast = (function () {
  "use strict";
  function show(msg, kind) {
    var host = document.getElementById("toast-host");
    if (!host) return;
    var node = document.createElement("div");
    node.className = "toast" + (kind === "error" ? " is-error" : "");
    node.textContent = msg;
    host.appendChild(node);
    /* 2,200 ms to read, then 180 ms of exit (--tablify-dur-toast-out). The old
       code set opacity to 0 with no transition declared, so the fade never
       happened — it blinked out. */
    var exit = TF.motion.reduced() ? 0 : 180;
    setTimeout(function () {
      node.classList.add("is-leaving");
      setTimeout(function () { node.remove(); }, exit);
    }, 2200);
    while (host.children.length > 3) host.removeChild(host.firstChild);
  }
  return { show: show };
})();

TF.dialogs = (function () {
  "use strict";
  var D = TF.data, Q = TF.query, IO = TF.io;

  /* ── modal shell ───────────────────────────────────────────────────────── */
  function modal(opts) {
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal' + (opts.xl ? " is-xl" : (opts.wide ? " is-wide" : "")) + '" role="dialog" aria-modal="true">' +
        '<header class="modal-head"><h3 class="modal-title"></h3><button class="modal-x" type="button" aria-label="Close">✕</button></header>' +
        '<div class="modal-body"></div>' +
        '<div class="modal-foot"></div>' +
      '</div>';
    var modalEl = overlay.querySelector(".modal");
    var titleEl = overlay.querySelector(".modal-title");
    var bodyEl = overlay.querySelector(".modal-body");
    var footEl = overlay.querySelector(".modal-foot");
    titleEl.textContent = opts.title || "";
    if (opts.subtitle) {
      var sub = document.createElement("div");
      sub.className = "settings-sub";
      sub.textContent = opts.subtitle;
      titleEl.appendChild(sub);
    }
    var api = {
      el: modalEl, overlay: overlay, body: bodyEl, foot: footEl,
      close: function () {
        if (overlay.classList.contains("is-closing")) return;
        document.removeEventListener("keydown", onKey);
        if (opts.onClose) opts.onClose();          /* stays synchronous: callers resolve on it */
        if (TF.motion.reduced()) { overlay.remove(); return; }
        /* 240 ms in, 160 ms out — an exit is faster than an entrance, because
           the user already decided; `pointer-events: none` comes from the CSS
           class, so nothing behind it waits for the animation to end */
        overlay.classList.add("is-closing");
        setTimeout(function () { overlay.remove(); }, 180);
      },
      refresh: function () { if (opts.body) { bodyEl.innerHTML = ""; opts.body(bodyEl, api); } },
    };
    function onKey(e) { if (e.key === "Escape") { api.close(); } }
    document.addEventListener("keydown", onKey);
    overlay.querySelector(".modal-x").addEventListener("click", api.close);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) api.close(); });
    var host = document.getElementById("modal-host");
    /* a dialog still playing its exit must not be reachable — or countable —
       once a new one opens */
    Array.prototype.forEach.call(host.querySelectorAll(".modal-overlay.is-closing"), function (n) { n.remove(); });
    host.appendChild(overlay);
    if (opts.body) opts.body(bodyEl, api);
    if (opts.foot) opts.foot(footEl, api);
    return api;
  }

  function btn(label, kind, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ob-btn" + (kind ? " is-" + kind : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }
  function row(label, control) {
    var r = document.createElement("div");
    r.className = "set-row";
    var main = document.createElement("div");
    main.className = "set-row-main";
    var name = document.createElement("div");
    name.className = "set-row-name";
    name.textContent = label;
    var ctl = document.createElement("div");
    ctl.className = "set-row-ctl";
    if (typeof control === "string") ctl.innerHTML = control; else ctl.appendChild(control);
    main.appendChild(name);
    r.appendChild(main);
    r.appendChild(ctl);
    return r;
  }

  /* confirm / prompt */
  function confirm(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      var api = modal({
        title: opts.title || "Are you sure?",
        body: function (body) {
          var p = document.createElement("p");
          p.className = "dlg-preview";
          p.textContent = opts.message || "";
          body.appendChild(p);
          if (opts.detail) {
            var d = document.createElement("div");
            d.className = "ob-hint";
            d.textContent = opts.detail;
            body.appendChild(d);
          }
        },
        foot: function (foot, m) {
          foot.appendChild(btn("Cancel", null, function () { settled = true; m.close(); resolve(false); }));
          var go = btn(opts.confirmLabel || "Confirm", opts.danger ? "danger" : "primary", function () { settled = true; m.close(); resolve(true); });
          foot.appendChild(go);
        },
        onClose: function () { if (!settled) resolve(false); },
      });
      void api;
    });
  }
  function prompt(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      var input = document.createElement("input");
      input.className = "ob-input";
      input.value = opts.value || "";
      input.placeholder = opts.placeholder || "";
      modal({
        title: opts.title || "Enter a value",
        body: function (body) {
          var f = document.createElement("div");
          f.className = "ob-field";
          var l = document.createElement("label");
          l.className = "ob-field-label";
          l.textContent = opts.label || "";
          f.appendChild(l); f.appendChild(input);
          if (opts.hint) {
            var h = document.createElement("div");
            h.className = "ob-hint";
            h.textContent = opts.hint;
            f.appendChild(h);
          }
          body.appendChild(f);
          setTimeout(function () { input.focus(); input.select(); }, 0);
        },
        foot: function (foot, m) {
          foot.appendChild(btn("Cancel", null, function () { settled = true; m.close(); resolve(null); }));
          foot.appendChild(btn(opts.confirmLabel || "Save", "primary", function () { settled = true; m.close(); resolve(input.value); }));
        },
        onClose: function () { if (!settled) resolve(null); },
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { settled = true; var v = input.value; var m = document.querySelector(".modal-overlay:last-child"); if (m) m.remove(); resolve(v); }
      });
    });
  }

  /* ── filter builder ────────────────────────────────────────────────────── */
  function filterPanel(ctx) {
    var store = ctx.store;
    modal({
      title: "Filter",
      wide: true,
      subtitle: "Conditions stack with AND/OR. The query string below is generated.",
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          var view = store.view();
          var fields = store.table().fields;

          var logic = document.createElement("div");
          logic.className = "tablify-seg";
          ["and", "or"].forEach(function (l) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "tablify-btn" + (view.filters.logic === l ? " is-on" : "");
            b.textContent = l.toUpperCase();
            b.addEventListener("click", function () { store.setLogic(l); draw(); m.refresh(); if (ctx.grid) ctx.grid.render(); });
            logic.appendChild(b);
          });
          var logicRow = document.createElement("div");
          logicRow.className = "tablify-bar";
          var lbl = document.createElement("span");
          lbl.className = "tablify-bar-label";
          lbl.textContent = "Match";
          logicRow.appendChild(lbl); logicRow.appendChild(logic);
          body.appendChild(logicRow);

          var list = document.createElement("div");
          list.className = "dlg-scroll";
          view.filters.conditions.forEach(function (c) {
            var line = document.createElement("div");
            line.className = "tablify-cond" + (conditionMatches(c, store) ? " is-match" : "");

            var fselect = document.createElement("select");
            fselect.className = "ob-input";
            fields.forEach(function (f) {
              var o = document.createElement("option");
              o.value = f.id; o.textContent = f.name;
              if (f.id === c.fieldId) o.selected = true;
              fselect.appendChild(o);
            });
            fselect.addEventListener("change", function () { store.updateCondition(c.id, { fieldId: fselect.value }); draw(); m.refresh(); ctx.grid.render(); });

            var field = fields.filter(function (f) { return f.id === c.fieldId; })[0];
            var oselect = document.createElement("select");
            oselect.className = "ob-input";
            Q.operatorsFor(field).forEach(function (op) {
              var o = document.createElement("option");
              o.value = op; o.textContent = Q.operatorLabel(op);
              if (op === c.op) o.selected = true;
              oselect.appendChild(o);
            });
            oselect.addEventListener("change", function () { store.updateCondition(c.id, { op: oselect.value }); draw(); m.refresh(); ctx.grid.render(); });

            line.appendChild(fselect); line.appendChild(oselect);

            if (Q.valueNeedsInput(c.op)) {
              if (field && field.options && (c.op === "is" || c.op === "isNot" || c.op === "isAnyOf" || c.op === "contains" || c.op === "containsAny" || c.op === "containsAll")) {
                var wrap = document.createElement("div");
                wrap.className = "tablify-chip";
                wrap.style.display = "flex";
                wrap.style.flexWrap = "wrap";
                wrap.style.gap = "4px";
                var chosen = c.op === "isAnyOf" || c.op.indexOf("contains") === 0 || c.op === "containsAll"
                  ? String(c.value || "").split(",").filter(Boolean) : [c.value];
                (field.options || []).forEach(function (o) {
                  var chip = document.createElement("button");
                  chip.type = "button";
                  chip.className = "tablify-btn" + (chosen.indexOf(o.id) !== -1 ? " is-on" : "");
                  chip.textContent = o.name;
                  chip.addEventListener("click", function () {
                    var next;
                    if (c.op === "is" || c.op === "isNot") next = o.id;
                    else {
                      var l = chosen.slice();
                      var i = l.indexOf(o.id);
                      if (i === -1) l.push(o.id); else l.splice(i, 1);
                      next = l.join(",");
                    }
                    store.updateCondition(c.id, { value: next });
                    draw(); m.refresh(); ctx.grid.render();
                  });
                  wrap.appendChild(chip);
                });
                line.appendChild(wrap);
              } else {
                var input = document.createElement("input");
                input.className = "ob-input";
                input.value = c.value == null ? "" : String(c.value);
                input.placeholder = field && field.type === "percent" ? "25 means 25%" : "value";
                input.addEventListener("change", function () { store.updateCondition(c.id, { value: input.value }); m.refresh(); ctx.grid.render(); });
                line.appendChild(input);
              }
            }
            var x = document.createElement("button");
            x.type = "button";
            x.className = "tablify-x";
            x.textContent = "✕";
            x.title = "Remove condition";
            x.addEventListener("click", function () { store.removeCondition(c.id); draw(); m.refresh(); ctx.grid.render(); });
            line.appendChild(x);
            list.appendChild(line);
          });
          if (!view.filters.conditions.length) {
            var empty = document.createElement("div");
            empty.className = "ob-hint";
            empty.textContent = "No conditions yet — add one, or type a query below.";
            list.appendChild(empty);
          }
          body.appendChild(list);

          var add = btn("+ Add condition", null, function () {
            store.addCondition((store.visibleFields()[0] || {}).id);
            draw(); m.refresh(); ctx.grid.render();
          });
          add.className = "ob-btn";
          body.appendChild(add);

          var q = document.createElement("input");
          q.className = "ob-input tablify-query";
          q.value = store.view().query;
          q.placeholder = 'status:~done and budget>1000 or empty(due)';
          q.addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            store.applyQuery(q.value);
            draw(); m.refresh(); ctx.grid.render();
          });
          var ql = document.createElement("div");
          ql.className = "ob-field-label";
          ql.textContent = "Query string (Enter to apply)";
          body.appendChild(ql); body.appendChild(q);
          var errs = store.view().queryErrors || [];
          if (errs.length) {
            var err = document.createElement("div");
            err.className = "tablify-err";
            err.textContent = errs.join(" · ");
            body.appendChild(err);
          }
        }
        draw();
      },
      foot: function (foot, m) {
        foot.appendChild(btn("Clear all", null, function () { store.clearFilters(); ctx.grid.render(); m.close(); }));
        foot.appendChild(btn("Done", "primary", function () { m.close(); ctx.grid.render(); }));
      },
    });
  }
  function conditionMatches(c, store) {
    var rows = store.table().rows;
    var f = store.fieldById(c.fieldId);
    if (!f) return false;
    return rows.some(function (r) { return Q.matches(r.cells[f.id], c.op, c.value, f); });
  }

  /* ── sort panel: real multi-level, drag-free up/down ───────────────────── */
  function sortPanel(ctx) {
    var store = ctx.store;
    modal({
      title: "Sort",
      subtitle: "Sorts apply in order — the second only breaks ties in the first.",
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          var view = store.view(), fields = store.table().fields;
          var list = document.createElement("div");
          list.className = "dlg-scroll";
          view.sorts.forEach(function (s, i) {
            var line = document.createElement("div");
            line.className = "tablify-cond";
            var num = document.createElement("span");
            num.className = "tablify-sortlevel";
            num.textContent = String(i + 1);
            var fselect = document.createElement("select");
            fselect.className = "ob-input";
            fields.forEach(function (f) {
              var o = document.createElement("option");
              o.value = f.id; o.textContent = f.name;
              if (f.id === s.fieldId) o.selected = true;
              fselect.appendChild(o);
            });
            fselect.addEventListener("change", function () { store.updateSort(s.id, { fieldId: fselect.value }); draw(); m.refresh(); ctx.grid.render(); });
            var dir = document.createElement("select");
            dir.className = "ob-input";
            [["asc", "A → Z / 1 → 9"], ["desc", "Z → A / 9 → 1"]].forEach(function (pair) {
              var o = document.createElement("option");
              o.value = pair[0]; o.textContent = pair[1];
              if (s.dir === pair[0]) o.selected = true;
              dir.appendChild(o);
            });
            dir.addEventListener("change", function () { store.updateSort(s.id, { dir: dir.value }); m.refresh(); ctx.grid.render(); });
            var up = document.createElement("button");
            up.type = "button"; up.className = "tablify-x"; up.textContent = "↑"; up.title = "Move up";
            up.addEventListener("click", function () { store.moveSort(s.id, -1); draw(); m.refresh(); ctx.grid.render(); });
            var down = document.createElement("button");
            down.type = "button"; down.className = "tablify-x"; down.textContent = "↓"; down.title = "Move down";
            down.addEventListener("click", function () { store.moveSort(s.id, 1); draw(); m.refresh(); ctx.grid.render(); });
            var x = document.createElement("button");
            x.type = "button"; x.className = "tablify-x"; x.textContent = "✕"; x.title = "Remove";
            x.addEventListener("click", function () { store.removeSort(s.id); draw(); m.refresh(); ctx.grid.render(); });
            line.appendChild(num); line.appendChild(fselect); line.appendChild(dir); line.appendChild(up); line.appendChild(down); line.appendChild(x);
            list.appendChild(line);
          });
          if (!view.sorts.length) {
            var e = document.createElement("div");
            e.className = "ob-hint";
            e.textContent = "No sorts. Grouped views still order groups by this list.";
            list.appendChild(e);
          }
          body.appendChild(list);
          body.appendChild(btn("+ Add sort", null, function () {
            /* pick the first field that is not sorted yet, and say so when there
               is none left instead of doing nothing */
            var used = store.view().sorts.map(function (x) { return x.fieldId; });
            var free = store.visibleFields().filter(function (f) { return used.indexOf(f.id) === -1; })[0];
            if (!free) { TF.toast.show("Every visible field is already in the sort", "error"); return; }
            store.addSort(free.id); draw(); m.refresh(); ctx.grid.render();
          }));
        }
        draw();
      },
      foot: function (foot, m) {
        foot.appendChild(btn("Clear", null, function () { store.clearSorts(); ctx.grid.render(); m.close(); }));
        foot.appendChild(btn("Done", "primary", function () { m.close(); ctx.grid.render(); }));
      },
    });
  }

  /* ── group by ──────────────────────────────────────────────────────────── */
  function groupPanel(ctx) {
    var store = ctx.store;
    modal({
      title: "Group rows",
      subtitle: "Groups follow the sort, and collapse state is remembered per group key.",
      body: function (body, m) {
        var fields = store.table().fields;
        var current = store.view().groupBy;
        var list = document.createElement("div");
        list.className = "dlg-choices";
        var none = document.createElement("button");
        none.type = "button";
        none.className = "dlg-choice" + (!current ? " is-picked" : "");
        none.innerHTML = '<span class="dlg-choice-name">No grouping</span><span class="dlg-choice-desc">A flat list of rows</span>';
        none.addEventListener("click", function () { store.setGroupBy(null); ctx.grid.render(); m.close(); });
        list.appendChild(none);
        fields.forEach(function (f) {
          var c = document.createElement("button");
          c.type = "button";
          c.className = "dlg-choice" + (current === f.id ? " is-picked" : "");
          c.innerHTML = '<span class="dlg-choice-name">' + D.esc(D.descriptor(f.type).icon + " " + f.name) + "</span>" +
            '<span class="dlg-choice-desc">' + D.esc(D.descriptor(f.type).label) + (f.options ? " · " + f.options.length + " options" : "") + "</span>";
          c.addEventListener("click", function () { store.setGroupBy(f.id); ctx.grid.render(); m.close(); });
          list.appendChild(c);
        });
        body.appendChild(list);
      },
    });
  }

  /* ── hide fields ───────────────────────────────────────────────────────── */
  function hidePanel(ctx) {
    var store = ctx.store;
    modal({
      title: "Hide fields",
      subtitle: "The primary field is always visible — it is the row's identity.",
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          var view = store.view();
          var list = document.createElement("div");
          list.className = "dlg-scroll";
          store.table().fields.forEach(function (f) {
            var hidden = view.hiddenFieldIds.indexOf(f.id) !== -1;
            var line = document.createElement("label");
            line.className = "opt-row";
            var cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "ob-check";
            cb.checked = !hidden;
            cb.disabled = !!f.primary;
            cb.addEventListener("change", function () { store.toggleHiddenField(f.id); draw(); m.refresh(); ctx.grid.render(); });
            var name = document.createElement("span");
            name.textContent = D.descriptor(f.type).icon + "  " + f.name + (f.primary ? "  (primary)" : "");
            line.appendChild(cb); line.appendChild(name);
            list.appendChild(line);
          });
          body.appendChild(list);
        }
        draw();
      },
      foot: function (foot, m) {
        foot.appendChild(btn("Show all", null, function () { store.showAllFields(); ctx.grid.render(); m.close(); }));
        foot.appendChild(btn("Done", "primary", function () { m.close(); }));
      },
    });
  }

  /* ── view / presets / layout ───────────────────────────────────────────── */
  function viewPanel(ctx) {
    var store = ctx.store;
    modal({
      title: "View settings",
      subtitle: ctx.grid.isNarrow && ctx.grid.isNarrow()
        ? "Row height and presets. Presets capture the whole view state."
        : "Row height, frozen primary column, presets. Presets capture the whole view state.",
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          var view = store.view();
          var seg = document.createElement("div");
          seg.className = "tablify-seg";
          [["short", "Short"], ["medium", "Medium"], ["tall", "Tall"]].forEach(function (pair) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "tablify-btn" + (view.rowHeight === pair[0] ? " is-on" : "");
            b.textContent = pair[1] + " · " + TF.grid.ROW_H[pair[0]];
            b.addEventListener("click", function () { store.setView({ rowHeight: pair[0] }, "row height"); draw(); ctx.grid.render(); });
            seg.appendChild(b);
          });
          body.appendChild(row("Row height", seg));

          /* hidden while the pane is too narrow to pin anything: a setting that
             visibly does nothing reads as a bug */
          if (!(ctx.grid.isNarrow && ctx.grid.isNarrow())) {
          var frozen = document.createElement("input");
          frozen.type = "checkbox"; frozen.className = "ob-check"; frozen.checked = !!view.frozenPrimary;
          frozen.addEventListener("change", function () { store.setView({ frozenPrimary: frozen.checked }, "toggle frozen column"); ctx.grid.render(); });
          body.appendChild(row("Freeze primary column (sticky)", frozen));
          }

          var nums = document.createElement("input");
          nums.type = "checkbox"; nums.className = "ob-check"; nums.checked = !!view.rowNumbers;
          nums.addEventListener("change", function () { store.setView({ rowNumbers: nums.checked }, "toggle gutters"); ctx.grid.render(); });
          body.appendChild(row("Row checkboxes + numbering", nums));

          var has = document.createElement("div");
          has.className = "ob-hint";
          var groups = view.groupBy ? "grouped by " + (store.fieldById(view.groupBy) || {}).name : "not grouped";
          has.textContent = "Active: " + view.sorts.length + " sort(s) · " +
            (view.filters.conditions.length + (view.filtersAst && !view.filters.conditions.length ? 1 : 0)) + " filter(s) · " +
            view.hiddenFieldIds.length + " hidden · " + groups;
          body.appendChild(has);

          var d = document.createElement("div");
          d.className = "ob-divider";
          body.appendChild(d);

          var list = document.createElement("div");
          list.className = "mig-list";
          store.get().presets.forEach(function (p) {
            var item = document.createElement("div");
            item.className = "mig-item";
            var name = document.createElement("span");
            name.textContent = p.name + "  ·  " + p.view.sorts.length + " sort(s), " + p.view.filters.conditions.length + " filter(s)";
            var apply = btn("Apply", null, function () { store.applyPreset(p.name); draw(); m.refresh(); ctx.grid.render(); });
            var del = btn("Delete", "danger", function () { store.deletePreset(p.name); draw(); m.refresh(); });
            item.appendChild(name); item.appendChild(apply); item.appendChild(del);
            list.appendChild(item);
          });
          if (!store.get().presets.length) {
            var none2 = document.createElement("div");
            none2.className = "ob-hint";
            none2.textContent = "No presets yet.";
            list.appendChild(none2);
          }
          body.appendChild(list);
          body.appendChild(btn("+ Save current view as preset…", null, function () {
            prompt({ title: "Save view preset", label: "Preset name", value: "Preset " + (store.get().presets.length + 1) }).then(function (name) {
              if (!name) return;
              store.savePreset(name);
              draw();
            });
          }));
        }
        draw();
      },
      foot: function (foot, m) { foot.appendChild(btn("Close", "primary", function () { m.close(); ctx.grid.render(); })); },
    });
  }

  /* ── field config ──────────────────────────────────────────────────────── */
  function fieldConfig(ctx, fieldId) {
    var store = ctx.store;
    var field = store.fieldById(fieldId);
    if (!field) return;
    modal({
      title: "Edit field",
      subtitle: field.name + " · " + D.descriptor(field.type).label,
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          var f = store.fieldById(fieldId);
          if (!f) { m.close(); return; }
          var nameInput = document.createElement("input");
          nameInput.className = "ob-input";
          nameInput.value = f.name;
          nameInput.addEventListener("change", function () { store.updateField(fieldId, { name: nameInput.value }); m.refresh(); ctx.grid.render(); });
          var nameField = document.createElement("div");
          nameField.className = "ob-field";
          var nl = document.createElement("label");
          nl.className = "ob-field-label";
          nl.textContent = "Name";
          nameField.appendChild(nl); nameField.appendChild(nameInput);
          body.appendChild(nameField);

          var typeField = document.createElement("div");
          typeField.className = "ob-field";
          var tl = document.createElement("label");
          tl.className = "ob-field-label";
          tl.textContent = "Type (converting keeps what it can)";
          var select = document.createElement("select");
          select.className = "ob-input";
          D.TYPE_ORDER.forEach(function (t) {
            var o = document.createElement("option");
            o.value = t; o.textContent = D.TYPES[t].label + "  " + D.TYPES[t].icon;
            if (t === f.type) o.selected = true;
            select.appendChild(o);
          });
          select.addEventListener("change", function () {
            store.convertField(fieldId, select.value);
            draw(); m.refresh(); ctx.grid.render();
            TF.toast.show("Converted to " + D.TYPES[select.value].label);
          });
          typeField.appendChild(tl); typeField.appendChild(select);
          body.appendChild(typeField);

          if (f.type === "rating") {
            var maxInput = document.createElement("input");
            maxInput.type = "number"; maxInput.min = "2"; maxInput.max = "10";
            maxInput.className = "ob-input"; maxInput.value = String(f.max || 5);
            maxInput.addEventListener("change", function () { store.updateField(fieldId, { max: Math.max(2, Math.min(10, Number(maxInput.value))) }); ctx.grid.render(); });
            body.appendChild(row("Maximum stars", maxInput));
          }
          if (f.type === "currency") {
            var symInput = document.createElement("input");
            symInput.className = "ob-input"; symInput.value = f.symbol || "$";
            symInput.addEventListener("change", function () { store.updateField(fieldId, { symbol: symInput.value }); ctx.grid.render(); });
            body.appendChild(row("Currency symbol", symInput));
          }

          var ro = document.createElement("div");
          ro.className = "ob-hint";
          ro.textContent = D.isReadOnly(f) ? "This field type is computed — cells are read-only (auto number / created / last modified)." : "Cells are editable.";
          body.appendChild(ro);

          if (f.options) {
            var d = document.createElement("div");
            d.className = "ob-divider";
            body.appendChild(d);
            var manage = btn("Manage " + f.options.length + " options…", null, function () { m.close(); optionManager(ctx, fieldId); });
            body.appendChild(manage);
          }
        }
        draw();
      },
      foot: function (foot, m) {
        foot.appendChild(btn("Duplicate field", null, function () { store.duplicateField(fieldId); ctx.grid.render(); m.close(); }));
        foot.appendChild(btn("Delete field", "danger", function () {
          confirm({ title: "Delete field", message: "Delete “" + field.name + "” and all of its data?", detail: "Undo (Ctrl+Z) brings it back.", confirmLabel: "Delete", danger: true }).then(function (ok) {
            if (!ok) return;
            store.deleteField(fieldId);
            ctx.grid.render(); m.close();
          });
        }));
        foot.appendChild(btn("Done", "primary", function () { m.close(); ctx.grid.render(); }));
      },
    });
  }

  /* ── option manager ────────────────────────────────────────────────────── */
  function optionManager(ctx, fieldId) {
    var store = ctx.store;
    modal({
      title: "Option manager",
      wide: true,
      subtitle: "Colours and order live in the .base sidecar, exactly as the spec requires.",
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          var f = store.fieldById(fieldId);
          if (!f || !f.options) { m.close(); return; }
          var list = document.createElement("div");
          list.className = "dlg-scroll";
          f.options.forEach(function (o, i) {
            var line = document.createElement("div");
            line.className = "opt-row";
            var swatch = document.createElement("button");
            swatch.type = "button";
            swatch.className = "opt-swatch pill--" + o.color;
            swatch.title = "Change colour";
            swatch.style.background = "var(--tablify-pill-" + o.color + ")";
            swatch.addEventListener("click", function (ev) {
              TF.menus.fromEvent(D.COLORS.map(function (c) {
                return { label: c, checked: c === o.color, onClick: function () { store.updateOption(fieldId, o.id, { color: c }); draw(); m.refresh(); ctx.grid.render(); } };
              }), ev);
            });
            var input = document.createElement("input");
            input.className = "ob-input";
            input.value = o.name;
            input.addEventListener("change", function () { store.updateOption(fieldId, o.id, { name: input.value }); draw(); m.refresh(); ctx.grid.render(); });
            var usage = document.createElement("span");
            usage.className = "ob-hint";
            usage.textContent = store.optionUsage(fieldId, o.id) + " used";
            var up = document.createElement("button");
            up.type = "button"; up.className = "tablify-x"; up.textContent = "↑";
            up.addEventListener("click", function () { store.reorderOption(fieldId, o.id, Math.max(0, i - 1)); draw(); m.refresh(); ctx.grid.render(); });
            var down = document.createElement("button");
            down.type = "button"; down.className = "tablify-x"; down.textContent = "↓";
            down.addEventListener("click", function () { store.reorderOption(fieldId, o.id, Math.min(f.options.length - 1, i + 1)); draw(); m.refresh(); ctx.grid.render(); });
            var del = document.createElement("button");
            del.type = "button"; del.className = "tablify-x"; del.textContent = "✕";
            del.addEventListener("click", function () {
              var used = store.optionUsage(fieldId, o.id);
              if (!used) { store.deleteOption(fieldId, o.id, false); draw(); m.refresh(); ctx.grid.render(); return; }
              confirm({
                title: "Delete option", detail: used + " row(s) use it.",
                message: "Choose what happens to the " + used + " row(s) using “" + o.name + "”.",
                confirmLabel: "Clear from rows", danger: true,
              }).then(function (ok) {
                store.deleteOption(fieldId, o.id, ok);
                draw(); m.refresh(); ctx.grid.render();
              });
            });
            line.appendChild(swatch); line.appendChild(input); line.appendChild(usage); line.appendChild(up); line.appendChild(down); line.appendChild(del);
            list.appendChild(line);
          });
          body.appendChild(list);
          body.appendChild(btn("+ Add option", null, function () { store.addOption(fieldId); draw(); m.refresh(); ctx.grid.render(); }));
        }
        draw();
      },
      foot: function (foot, m) { foot.appendChild(btn("Done", "primary", function () { m.close(); })); },
    });
  }

  /* ── cell / header / gutter menus ──────────────────────────────────────── */
  function cellMenu(ctx, r, c, ev) {
    var store = ctx.store, grid = ctx.grid;
    var sel = grid.getSelection();
    var field = store.visibleFields()[c - 1];
    var item = grid.rowItems()[r];
    var multi = sel.rows.length > 1 || sel.fields.length > 1;
    var items = [
      { label: "Copy" + (multi ? " " + sel.rows.length + "×" + sel.fields.length : ""), key: "Ctrl+C", onClick: function () { grid.copySelection(false); } },
      { label: "Cut", key: "Ctrl+X", onClick: function () { grid.copySelection(true); clearSelection(); } },
      { label: "Paste", key: "Ctrl+V", disabled: !multi, onClick: function () { grid.pasteMatrixFromClipboard(); } },
      { sep: true },
      { label: "Insert row above", onClick: function () { store.insertRows(1, Math.max(0, r)); } },
      { label: "Insert row below", onClick: function () { store.insertRows(1, r + 1); } },
      { label: "Duplicate row" + (sel.rows.length > 1 ? "s" : ""), onClick: function () { store.duplicateRows(sel.rows.map(function (x) { return x.id; })); } },
      { label: "Delete row" + (sel.rows.length > 1 ? "s" : ""), danger: true, onClick: function () {
        store.deleteRows(sel.rows.map(function (x) { return x.id; }));
      } },
      { sep: true },
      { label: "Fill down", key: "Ctrl+D", disabled: sel.rows.length < 2, onClick: function () { grid.fillDown(); } },
      { label: "Fill right", key: "Ctrl+R", disabled: sel.fields.length < 2, onClick: function () { grid.fillRight(); } },
      { label: "Clear cells", key: "Del", onClick: function () { grid.clearValues(sel.rows, sel.fields); } },
      { sep: true },
      { label: "Set every selected row to…", disabled: !field || D.isReadOnly(field), onClick: function () {
        prompt({ title: "Bulk edit “" + (field || {}).name + "”", label: "Value for " + sel.rows.length + " row(s)", value: "" }).then(function (v) {
          if (v == null) return;
          grid.editWholeColumn(v);
        });
      } },
      { label: "Row details…", onClick: function () {
        if (!item) return;
        rowDetails(ctx, item.row.id);
      } },
    ];
    if (ev && ev.clientX != null) TF.menus.fromEvent(items, ev);
    else TF.menus.open(items, 40, 120);
    void c;
    function clearSelection() {
      var n = grid.clearValues(sel.rows, sel.fields);
      store.announce(n + " cell(s) cut");
    }
  }

  function headerMenu(ctx, field, ev) {
    var store = ctx.store, grid = ctx.grid;
    if (!field) return;
    var view = store.view();
    var sorted = view.sorts.filter(function (s) { return s.fieldId === field.id; })[0];
    var hidden = view.hiddenFieldIds.indexOf(field.id) !== -1;
    var canHide = !field.primary;
    var items = [
      { label: "Sort ascending", checked: sorted && sorted.dir === "asc" && view.sorts.length === 1, onClick: function () { store.setView({ sorts: [{ id: "s_" + Math.random().toString(36).slice(2, 7), fieldId: field.id, dir: "asc" }] }, "sort ascending"); grid.render(); } },
      { label: "Sort descending", checked: sorted && sorted.dir === "desc" && view.sorts.length === 1, onClick: function () { store.setView({ sorts: [{ id: "s_" + Math.random().toString(36).slice(2, 7), fieldId: field.id, dir: "desc" }] }, "sort descending"); grid.render(); } },
      { label: "Add to sort (multi-sort)…", onClick: function () { store.addSort(field.id); sortPanel(ctx); grid.render(); } },
      { label: "Group by this field", checked: view.groupBy === field.id, onClick: function () { store.setGroupBy(view.groupBy === field.id ? null : field.id); grid.render(); } },
      { sep: true },
      { label: "Filter this field…", onClick: function () { store.addCondition(field.id); filterPanel(ctx); grid.render(); } },
      { label: "Hide field", disabled: !canHide, onClick: function () { store.toggleHiddenField(field.id); grid.render(); } },
      { label: hidden ? "Show field" : "Show all fields", onClick: function () { store.showAllFields(); grid.render(); } },
      { sep: true },
      { label: "Edit field…", onClick: function () { fieldConfig(ctx, field.id); } },
      { label: "Change type…", onClick: function () { fieldConfig(ctx, field.id); } },
      field.options ? { label: "Manage options…", onClick: function () { optionManager(ctx, field.id); } } : { label: "Duplicate field", onClick: function () { store.duplicateField(field.id); grid.render(); } },
      { label: "Insert field right", onClick: function () {
        modal({ title: "Insert field", subtitle: "Placed to the right of “" + field.name + "”.", body: function (body, m) {
          D.TYPE_ORDER.forEach(function (t) {
            var b = document.createElement("button");
            b.type = "button"; b.className = "dlg-choice";
            b.innerHTML = '<span class="dlg-choice-name">' + D.TYPES[t].icon + " " + D.TYPES[t].label + "</span>" +
              '<span class="dlg-choice-desc">' + (D.TYPES[t].editable ? "Editable" : "Computed / read-only") + "</span>";
            b.addEventListener("click", function () {
              var idx = store.table().fields.indexOf(store.fieldById(field.id)) + 1;
              store.addField(t, idx);
              grid.render(); m.close();
            });
            body.appendChild(b);
          });
        } });
      } },
      { sep: true },
      { label: "Resize to fit contents", onClick: function () {
        store.resizeColumn(field.id, autoWidth(field, store));
        grid.render();
      } },
      { label: "Delete field", danger: true, disabled: !!field.primary, onClick: function () {
        confirm({ title: "Delete field", message: "Delete “" + field.name + "” and its data in every row?", confirmLabel: "Delete", danger: true }).then(function (ok) {
          if (!ok) return;
          store.deleteField(field.id); grid.render();
        });
      } },
    ];
    TF.menus.fromEvent(items, ev);
  }
  function autoWidth(field, store) {
    var max = field.name.length * 8 + 44;
    store.table().rows.forEach(function (row) {
      var t = String(D.formatCell(field, row.cells[field.id]).text || "");
      max = Math.max(max, t.length * 7.4 + 26);
    });
    return Math.min(520, Math.max(90, Math.round(max)));
  }

  function gutterMenu(ctx, index, ev) {
    var store = ctx.store, grid = ctx.grid;
    var it = grid.items()[index];
    var rowId = it && it.row ? it.row.id : null;
    var ids = grid.getChecked().length ? grid.getChecked() : (rowId ? [rowId] : []);
    if (!ids.length) return;
    TF.menus.fromEvent([
      { label: "Select " + ids.length + " row(s)", onClick: function () { grid.setChecked([]); grid.selectAll(); } },
      { label: "Row details…", onClick: function () { rowDetails(ctx, rowId); } },
      { sep: true },
      { label: "Duplicate", onClick: function () { store.duplicateRows(ids); grid.render(); } },
      { label: "Copy rows as Markdown", onClick: function () {
        var rows = ids.map(function (id) { return store.rowById(id); }).filter(Boolean);
        var fields = store.visibleFields();
        IO.copyText(IO.toMarkdown(fields, rows));
        TF.toast.show("Copied " + rows.length + " row(s) as Markdown");
      } },
      { sep: true },
      { label: "Delete " + ids.length + " row(s)", danger: true, onClick: function () {
        store.deleteRows(ids); grid.setChecked([]); grid.render();
      } },
    ], ev);
  }

  /* row details: the "row = note" story made concrete */
  function rowDetails(ctx, rowId) {
    var store = ctx.store;
    var row = store.rowById(rowId);
    if (!row) return;
    var table = store.table();
    modal({
      title: "Row details",
      wide: true,
      subtitle: "In the real plugin this is a note on disk: " + table.name + "/" + (row.cells[table.fields[0].id] || "untitled") + ".md",
      body: function (body, m) {
        var head = document.createElement("div");
        head.className = "dlg-preview dlg-mono";
        head.textContent = "---\n" + table.fields.map(function (f) {
          var v = row.cells[f.id];
          return f.name.toLowerCase().replace(/\s+/g, "_") + ": " + (D.isEmptyValue(v) ? "" : D.toPlain(f, v));
        }).join("\n") + "\n---";
        body.appendChild(head);
        var note = document.createElement("div");
        note.className = "ob-hint";
        note.textContent = "Read-only preview: the prototype keeps rows in memory. YAML stays scalars and lists of scalars.";
        body.appendChild(note);
      },
      foot: function (foot, m) { foot.appendChild(btn("Close", "primary", function () { m.close(); })); },
    });
  }

  /* ── paste block dialog (cut/copy/paste with modes) ────────────────────── */
  function pasteBlockDialog(ctx, matrix, apply) {
    modal({
      title: "Paste " + matrix.length + " × " + (matrix[0] ? matrix[0].length : 0) + " block",
      subtitle: "This paste is large. Choose how it lands.",
      body: function (body, m) {
        var choices = [
          { id: "cells", name: "Fill cells from the selection", desc: "Overwrites the rectangle starting at the active cell; extra rows are created." },
          { id: "append", name: "Append as new rows", desc: "Adds every pasted row at the bottom of the table." },
          { id: "create", name: "Create rows in this table from the block", desc: "Maps columns by header name when the first row looks like headers." },
        ];
        choices.forEach(function (c) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "dlg-choice";
          b.innerHTML = '<span class="dlg-choice-name">' + D.esc(c.name) + '</span><span class="dlg-choice-desc">' + D.esc(c.desc) + "</span>";
          b.addEventListener("click", function () { m.close(); apply(c.id); });
          body.appendChild(b);
        });
        var prev = document.createElement("div");
        prev.className = "dlg-preview dlg-mono";
        prev.textContent = matrix.slice(0, 4).map(function (r) { return r.slice(0, 6).join(" | "); }).join("\n") +
          (matrix.length > 4 ? "\n… " + (matrix.length - 4) + " more row(s)" : "");
        body.appendChild(prev);
      },
    });
  }

  /* ── import wizard ─────────────────────────────────────────────────────── */
  function importWizard(ctx, opts) {
    var store = ctx.store, grid = ctx.grid;
    opts = opts || {};
    /* when the caller already handed us a block, go straight to the preview:
       the source picker is only there for the interactive path */
    var state = { step: opts.matrix ? 1 : 0, matrix: opts.matrix || null, fileName: opts.fileName || "", analysis: null, mode: "append", header: true, targetName: "" };

    var m = modal({
      title: "Import",
      xl: true,
      subtitle: "",
      body: function (body, api) { draw(body, api); },
    });
    return m;

    function draw(body, api) {
      body.innerHTML = "";
      var sub = api.el.querySelector(".settings-sub");
      if (sub) sub.textContent = state.step === 0 ? "Pick a source. The prototype parses CSV for real, and reads XLSX/ODS through a real ZIP + XML reader where the browser allows it." :
        state.step === 1 ? (state.matrix ? state.matrix.length + " rows × " + state.matrix[0].length + " columns detected" + (state.fileName ? " in " + state.fileName : "") : "") :
        "Confirm what should happen.";
      if (state.step === 0) drawSource(body, api);
      else if (state.step === 1) drawPreview(body, api);
      else drawConfirm(body, api);
    }

    function drawSource(body, api) {
      api.foot.innerHTML = "";
      var box = document.createElement("div");
      box.className = "dlg-choices";
      [["csv", "CSV / TSV text", "Paste text or choose a .csv file. Quoted fields and newlines are handled."],
       ["xlsx", "Excel or ODS file", "Read in the browser; the prototype shows the raw matrix if a sheet cannot be decoded."],
       ["clipboard", "Clipboard", "Paste from a spreadsheet; HTML tables are detected and preferred."],
       ["tabula", "Legacy .tabula file", "Read-only import with a dry run — no file is ever rewritten."]].forEach(function (pair) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "dlg-choice";
        b.innerHTML = '<span class="dlg-choice-name">' + pair[1] + '</span><span class="dlg-choice-desc">' + pair[2] + "</span>";
        b.addEventListener("click", function () { chooseSource(pair[0], body, api); });
        box.appendChild(b);
      });
      body.appendChild(box);
      if (opts.matrix) {
        var quick = btn("Use the block already on the clipboard (" + opts.matrix.length + " rows)", "primary", function () {
          state.matrix = opts.matrix; state.step = 1; state.targetName = store.table().name + " (copy)";
          state.fileName = "clipboard";
          draw(body, api);
        });
        body.appendChild(quick);
      }
      var hint = document.createElement("div");
      hint.className = "ob-hint";
      hint.textContent = "Rows always become notes in the real plugin. This prototype keeps them in memory so you can see the behaviour.";
      body.appendChild(hint);
    }

    function chooseSource(kind, body, api) {
      if (kind === "csv" || kind === "clipboard") {
        var box = document.createElement("div");
        box.className = "ob-field";
        var label = document.createElement("label");
        label.className = "ob-field-label";
        label.textContent = "Paste CSV or TSV here (Ctrl+V works too)";
        var ta = document.createElement("textarea");
        ta.className = "ob-textarea";
        ta.style.minHeight = "160px";
        ta.placeholder = "task,status,budget\nFix the top scrollbar,done,1200";
        box.appendChild(label); box.appendChild(ta);
        body.innerHTML = "";
        body.appendChild(box);
        var actions = document.createElement("div");
        actions.className = "tablify-bar";
        actions.appendChild(btn("← Back", null, function () { draw(body, api); }));
        actions.appendChild(btn("Use this text", "primary", function () {
          var text = ta.value || D.SAMPLE_CSV;
          state.matrix = text.indexOf("\t") !== -1 && text.indexOf(",") === -1 ? IO.parseTSV(text) : IO.parseCSV(text);
          state.fileName = "pasted text";
          state.step = 1;
          draw(body, api);
        }));
        var sample = btn("Load the 13-row sample sheet", null, function () { ta.value = D.SAMPLE_CSV; ta.focus(); });
        actions.appendChild(sample);
        body.appendChild(actions);
        setTimeout(function () { ta.focus(); }, 0);
        if (kind === "clipboard" && navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(function (t) { if (t) ta.value = t; }).catch(function () {});
        }
        return;
      }
      if (kind === "xlsx") {
        var field = document.createElement("div");
        field.className = "ob-field";
        var l = document.createElement("label");
        l.className = "ob-field-label";
        l.textContent = "Choose a .xlsx or .ods file";
        var input = document.createElement("input");
        input.type = "file";
        input.className = "ob-input";
        input.accept = ".xlsx,.ods,.csv";
        input.addEventListener("change", function () {
          var file = input.files && input.files[0];
          if (!file) return;
          readSpreadsheet(file).then(function (matrix) {
            if (!matrix) {
              TF.toast.show("Could not decode " + file.name + " — the real plugin uses read-excel-file", "error");
              return;
            }
            state.matrix = matrix; state.fileName = file.name; state.step = 1;
            draw(body, api);
          });
        });
        field.appendChild(l); field.appendChild(input);
        body.innerHTML = "";
        body.appendChild(field);
        var back = document.createElement("div");
        back.className = "tablify-bar";
        back.appendChild(btn("← Back", null, function () { draw(body, api); }));
        body.appendChild(back);
        return;
      }
      /* tabula */
      var tq = document.createElement("div");
      tq.className = "dlg-choices";
      TF.legacy.docs().filter(function (d) { return d.valid; }).forEach(function (doc) {
        doc.tables.forEach(function (t) {
          var b = document.createElement("button");
          b.type = "button"; b.className = "dlg-choice";
          b.innerHTML = '<span class="dlg-choice-name">' + D.esc(t.name) + "  ·  " + t.rows.length + " rows</span>" +
            '<span class="dlg-choice-desc">From ' + D.esc(doc.name) + " (" + doc.version + ") — dry run only, the file is never written</span>";
          b.addEventListener("click", function () {
            m.close();
            tabulaDryRun(ctx, doc, t);
          });
          tq.appendChild(b);
        });
      });
      body.innerHTML = "";
      body.appendChild(tq);
      body.appendChild(btn("← Back", null, function () { draw(body, api); }));
    }

    function drawPreview(body, api) {
      var analysis = IO.analyzeMatrix(state.matrix, state.header);
      state.analysis = analysis;
      var head = document.createElement("div");
      head.className = "tablify-bar";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.className = "ob-check"; cb.checked = state.header;
      cb.addEventListener("change", function () { state.header = cb.checked; draw(body, api); });
      var lbl = document.createElement("span");
      lbl.className = "tablify-bar-label";
      lbl.textContent = "First row is a header";
      head.appendChild(cb); head.appendChild(lbl);
      var count = document.createElement("span");
      count.className = "ob-hint";
      count.style.marginLeft = "auto";
      count.textContent = state.matrix.length + " rows × " + analysis.width + " columns";
      head.appendChild(count);
      body.appendChild(head);

      if (state.matrix.length > store.get().settings.threshold) {
        var warn = document.createElement("div");
        warn.className = "ob-banner is-warn dlg-warn";
        warn.textContent = "⚠ " + state.matrix.length + " rows is above the warning threshold (" + store.get().settings.threshold + "). " +
          "In the real plugin you would be asked each time: import as notes (one file per row), or keep it inside a single .tabula file. " +
          "Rough estimate: " + state.matrix.length + " note files plus index updates.";
        body.appendChild(warn);
      }

      var table = document.createElement("div");
      table.className = "dlg-scroll";
      var grid = document.createElement("div");
      grid.className = "dlg-table";
      var headerRow = document.createElement("div");
      headerRow.className = "dlg-conflict-head";
      ["Use", "Column", "Type", "Detected from"].forEach(function (t) {
        var th = document.createElement("span");
        th.textContent = t;
        headerRow.appendChild(th);
      });
      headerRow.style.display = "grid";
      headerRow.style.gridTemplateColumns = "44px 1.4fr 150px 1.6fr";
      grid.appendChild(headerRow);
      analysis.columns.forEach(function (col) {
        var line = document.createElement("div");
        line.className = "tablify-cond";
        line.style.display = "grid";
        line.style.gridTemplateColumns = "44px 1.4fr 150px 1.6fr";
        line.style.alignItems = "center";
        var use = document.createElement("input");
        use.type = "checkbox"; use.className = "ob-check"; use.checked = !col.skip;
        use.addEventListener("change", function () { col.skip = !use.checked; draw(body, api); });
        var name = document.createElement("input");
        name.className = "ob-input";
        name.value = col.name;
        name.addEventListener("change", function () { col.name = name.value; draw(body, api); });
        var type = document.createElement("select");
        type.className = "ob-input";
        D.TYPE_ORDER.forEach(function (t) {
          var o = document.createElement("option");
          o.value = t; o.textContent = D.TYPES[t].label;
          if (t === col.type) o.selected = true;
          type.appendChild(o);
        });
        type.addEventListener("change", function () { col.type = type.value; draw(body, api); });
        var sample = document.createElement("span");
        sample.className = "ob-hint";
        sample.textContent = col.samples.length ? col.samples.join(", ").slice(0, 46) : "all empty";
        line.appendChild(use); line.appendChild(name); line.appendChild(type); line.appendChild(sample);
        grid.appendChild(line);
      });
      table.appendChild(grid);
      body.appendChild(table);

      if (state.mode === "append") {
        var plan = IO.appendPlan(analysis, store.table().fields);
        var info = document.createElement("div");
        info.className = "ob-hint";
        var mapped = Object.keys(plan.mapping).length;
        info.textContent = "Append: " + mapped + " column(s) map to existing fields by name" +
          (plan.newColumns.length ? ", " + plan.newColumns.length + " new field(s) will be created: " + plan.newColumns.map(function (c) { return c.name; }).join(", ") : "") + ".";
        body.appendChild(info);
      }
      /* the preview is a step, not a dead end: without this the wizard could
         never be completed from the keyboard or the mouse */
      api.foot.innerHTML = "";
      api.foot.appendChild(btn("‹ Back", null, function () { state.step = 0; draw(body, api); }));
      api.foot.appendChild(btn("Continue ›", "primary", function () { state.step = 2; draw(body, api); }));
    }

    function drawConfirm(body, api) {
      var analysis = state.analysis || IO.analyzeMatrix(state.matrix, state.header);
      var choices = [
        { id: "append", name: "Append to “" + store.table().name + "”", desc: "Columns match by name; unmatched incoming columns become new fields." },
        { id: "replace", name: "Replace “" + store.table().name + "” contents", desc: "Deletes every existing row first. Undo puts them back." },
        { id: "create", name: "Create a new table", desc: "Keeps this table untouched and switches to the new one." },
      ];
      choices.forEach(function (c) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "dlg-choice" + (state.mode === c.id ? " is-picked" : "");
        b.innerHTML = '<span class="dlg-choice-name">' + D.esc(c.name) + '</span><span class="dlg-choice-desc">' + D.esc(c.desc) + "</span>";
        b.addEventListener("click", function () { state.mode = c.id; draw(body, api); });
        body.appendChild(b);
      });
      if (state.mode === "create") {
        var input = document.createElement("input");
        input.className = "ob-input";
        input.placeholder = "New table name";
        input.value = state.targetName || (state.fileName ? state.fileName.replace(/\.[a-z]+$/i, "") : "Imported " + new Date().toISOString().slice(0, 10));
        input.addEventListener("change", function () { state.targetName = input.value; });
        state.targetName = state.targetName || input.value;
        body.appendChild(input);
      }
      var stats = document.createElement("div");
      stats.className = "dlg-stats";
      var kept = (state.analysis ? state.analysis.columns.filter(function (c) { return !c.skip; }).length : 0);
      [[String(state.matrix.length), "rows"], [String(kept), "columns"]].forEach(function (pair) {
        var s = document.createElement("div");
        s.className = "dlg-stat";
        s.innerHTML = '<span class="dlg-stat-num">' + pair[0] + '</span><span class="dlg-stat-lbl">' + pair[1] + "</span>";
        stats.appendChild(s);
      });
      body.appendChild(stats);
      var foot = api.foot;
      foot.innerHTML = "";
      foot.appendChild(btn("← Back", null, function () { state.step = 1; draw(body, api); }));
      foot.appendChild(btn("Import", "primary", function () { runImport(analysis); m.close(); }));
    }

    function runImport(analysis) {
      var built = IO.toTable(analysis);
      if (state.mode === "create") {
        store.addTable({
          id: "tbl_" + Math.random().toString(36).slice(2, 7),
          name: state.targetName || "Imported table",
          fields: built.fields, rows: built.rows, autoNumberNext: built.rows.length + 1, sync: null,
        });
        TF.toast.show("Created " + (state.targetName || "a new table") + " with " + built.rows.length + " rows");
      } else if (state.mode === "replace") {
        store.replaceTableCells(built.fields, built.rows);
        TF.toast.show("Replaced table data — " + built.rows.length + " rows");
      } else {
        var plan = IO.appendPlan(analysis, store.table().fields);
        var mappings = Object.keys(plan.mapping);
        if (plan.newColumns.length) {
          plan.newColumns.forEach(function (col) {
            var idx = store.table().fields.length;
            var id = store.addField(col.type, idx);
            var f = store.fieldById(id);
            if (f) {
              store.updateField(id, { name: col.name });
              if ((col.type === "singleSelect" || col.type === "multiSelect")) {
                var seen = {}, opts = [];
                analysis.rows.forEach(function (r) {
                  var v = r[col.index] == null ? "" : String(r[col.index]).trim();
                  if (!v) return;
                  v.split(",").map(function (s) { return s.trim(); }).forEach(function (part) {
                    if (!part || seen[part]) return;
                    seen[part] = 1;
                    opts.push({ id: "o_imp2_" + col.index + "_" + opts.length, name: part, color: D.COLORS[opts.length % D.COLORS.length] });
                  });
                });
                store.updateField(id, { options: opts.length ? opts : [{ id: "o_imp2_empty", name: "New", color: "blue" }] });
              }
            }
            plan.mapping[col.index] = id;
          });
        }
        var rows = analysis.rows.map(function (r) {
          var cells = {};
          Object.keys(plan.mapping).forEach(function (colIdx) {
            var fid = plan.mapping[colIdx];
            var f = store.fieldById(fid);
            if (!f) return;
            var raw = r[Number(colIdx)] == null ? "" : String(r[Number(colIdx)]);
            cells[fid] = raw === "" ? D.clone(D.descriptor(f.type).default) : D.fromPlain(f, raw);
          });
          return { cells: cells };
        });
        store.appendRows(rows);
        TF.toast.show("Appended " + rows.length + " rows (" + mappings.length + " matched columns)");
      }
      grid.render();
    }
  }

  /* a real, if small, XLSX reader: central directory + shared strings + sheet */
  function readSpreadsheet(file) {
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
        return IO.parseCSV(new TextDecoder().decode(bytes));
      }
      var files = {};
      var i = 0;
      while (i < bytes.length - 4) {
        if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
          var dv = new DataView(bytes.buffer, i);
          var method = dv.getUint16(10, true);
          var size = dv.getUint32(20, true);
          var nameLen = dv.getUint16(28, true);
          var extraLen = dv.getUint16(30, true);
          var commentLen = dv.getUint16(32, true);
          var offset = dv.getUint32(42, true);
          var name = new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLen));
          if (method === 0) {
            files[name] = bytes.subarray(offset + 30 + extraLen + commentLen, offset + 30 + extraLen + commentLen + size);
          }
          i += 46 + nameLen + extraLen + commentLen;
        } else i++;
      }
      var dec = new TextDecoder();
      var shared = [];
      if (files["xl/sharedStrings.xml"]) {
        var ss = dec.decode(files["xl/sharedStrings.xml"]);
        var items = ss.split("<si>").slice(1);
        shared = items.map(function (chunk) {
          return (chunk.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map(function (t) {
            return t.replace(/<[^>]+>/g, "");
          }).join("").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
        });
      }
      var sheetKey = Object.keys(files).filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); })[0];
      if (!sheetKey) return null;
      var xml = dec.decode(files[sheetKey]);
      var rows = [];
      (xml.match(/<row[\s\S]*?<\/row>/g) || []).forEach(function (rowXml) {
        var row = [];
        (rowXml.match(/<c [\s\S]*?(\/>|<\/c>)/g) || []).forEach(function (c) {
          var refM = c.match(/r="([A-Z]+)\d+"/);
          var col = 0;
          if (refM) { for (var k = 0; k < refM[1].length; k++) col = col * 26 + (refM[1].charCodeAt(k) - 64); col -= 1; }
          var isShared = /t="s"/.test(c);
          var isInline = /t="(inlineStr|str)"/.test(c);
          var vM = c.match(/<v>([\s\S]*?)<\/v>/);
          var tM = c.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          var value = "";
          if (isShared && vM) value = shared[Number(vM[1])] || "";
          else if (isInline && tM) value = tM[1];
          else if (vM) value = vM[1];
          value = String(value).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
          while (row.length < col) row.push("");
          row[col] = value;
        });
        rows.push(row);
      });
      return rows.length ? rows : null;
    }).catch(function () { return null; });
  }

  /* ── .tabula dry run ───────────────────────────────────────────────────── */
  function tabulaDryRun(ctx, doc, table) {
    var store = ctx.store, grid = ctx.grid;
    var rep = TF.legacy.report(table);
    var record = {
      docId: doc.id, fileName: doc.name, tableName: table.name,
      rows: rep.rows, columns: table.fields.length,
      createdAt: doc.createdAt, migratedAt: new Date().toISOString(),
      unmappedColumns: rep.unmappable.map(function (c) { return c.name; }),
      orphanRows: rep.missingPrimary, computed: rep.computed,
      files: rep.rows,
    };
    modal({
      title: "Migrate “" + table.name + "”",
      xl: true,
      subtitle: "Dry run of " + doc.name + " (" + doc.version + ") — nothing is written until you confirm.",
      body: function (body) {
        var stats = document.createElement("div");
        stats.className = "dlg-stats";
        [[String(rep.rows), "rows → notes"], [String(table.fields.length), "columns mapped"], [String(rep.computed), "recomputed"], [String(rep.missingPrimary), "rows missing a primary value"]].forEach(function (pair) {
          var s = document.createElement("div");
          s.className = "dlg-stat";
          s.innerHTML = '<span class="dlg-stat-num">' + pair[0] + '</span><span class="dlg-stat-lbl">' + pair[1] + "</span>";
          stats.appendChild(s);
        });
        body.appendChild(stats);

        var map = document.createElement("div");
        map.className = "dlg-table";
        var head = document.createElement("div");
        head.className = "dlg-conflict-head";
        head.style.display = "grid";
        head.style.gridTemplateColumns = "1fr 1fr 170px 1.3fr";
        ["Legacy column", "Becomes", "Type", "Note"].forEach(function (t) { var s = document.createElement("span"); s.textContent = t; head.appendChild(s); });
        map.appendChild(head);
        rep.columns.forEach(function (c) {
          var line = document.createElement("div");
          line.className = "tablify-cond";
          line.style.display = "grid";
          line.style.gridTemplateColumns = "1fr 1fr 170px 1.3fr";
          line.style.alignItems = "center";
          var a = document.createElement("span");
          a.textContent = c.name + (c.from ? " (was " + c.from + ")" : "");
          var b = document.createElement("span");
          b.textContent = c.name + " ".trim() ? "front-matter key “" + c.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "”" : "";
          var t = document.createElement("span");
          t.textContent = D.descriptor(c.to).icon + " " + D.descriptor(c.to).label;
          var n = document.createElement("span");
          n.className = "ob-hint";
          n.textContent = c.note;
          line.appendChild(a); line.appendChild(b); line.appendChild(t); line.appendChild(n);
          map.appendChild(line);
        });
        body.appendChild(map);

        var warn = document.createElement("div");
        warn.className = "ob-banner dlg-warn";
        warn.textContent = "After migrating, “" + doc.name + "” stays read-only. The importer never writes to .tabula files.";
        body.appendChild(warn);
        var write = document.createElement("input");
        write.type = "checkbox"; write.className = "ob-check";
        write.id = "tf-dry-write";
        var wl = document.createElement("label");
        wl.className = "ob-hint";
        wl.textContent = "I understand the source file is frozen and not modified.";
        wl.htmlFor = "tf-dry-write";
        var wr = document.createElement("div");
        wr.className = "tablify-bar";
        wr.appendChild(write); wr.appendChild(wl);
        body.appendChild(wr);
      },
      foot: function (foot, mm) {
        foot.appendChild(btn("Cancel", null, function () { mm.close(); }));
        var go = btn("Migrate " + rep.rows + " rows", "primary", function () {
          var cb = mm.el.querySelector("#tf-dry-write");
          if (cb && !cb.checked) { TF.toast.show("Tick the confirmation box first", "error"); return; }
          var built = TF.legacy.toTable(table, store);
          store.addTable({
            id: "tbl_" + Math.random().toString(36).slice(2, 7),
            name: table.name + " (imported)",
            fields: built.fields, rows: built.rows,
            autoNumberNext: built.rows.length + 1, sync: null,
          });
          store.recordMigration(record);
          TF.toast.show("Imported " + built.rows.length + " rows from " + doc.name + " — the source file is untouched");
          mm.close();
          grid.render();
        });
        foot.appendChild(go);
      },
    });
  }

  /* ── export ────────────────────────────────────────────────────────────── */
  function exportDialog(ctx) {
    var store = ctx.store, grid = ctx.grid;
    var sel = grid.getSelection();
    var opts = { format: "csv", scope: "view", header: true, includeHidden: false };
    modal({
      title: "Export",
      subtitle: "Bases covers grid, cards, kanban and CSV. This dialog is for a file you can hand to someone.",
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          var formats = [
            ["csv", "CSV", "Comma-separated. Opens anywhere, loses types."],
            ["tsv", "TSV / clipboard", "Tabs — pastes straight back into any spreadsheet."],
            ["xlsx", "Excel (.xlsx)", "Written in the browser: a real workbook, types preserved as text."],
            ["md", "Markdown table", "For pasting into a note."],
            ["json", "JSON", "Array of row objects, keyed by field name."],
          ];
          var list = document.createElement("div");
          list.className = "dlg-choices";
          formats.forEach(function (f) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "dlg-choice" + (opts.format === f[0] ? " is-picked" : "");
            b.innerHTML = '<span class="dlg-choice-name">' + f[1] + '</span><span class="dlg-choice-desc">' + f[2] + "</span>";
            b.addEventListener("click", function () { opts.format = f[0]; draw(); });
            list.appendChild(b);
          });
          body.appendChild(list);

          var scopes = document.createElement("div");
          scopes.className = "tablify-seg";
          [["view", "Whole view (" + grid.rowItems().length + " rows)"],
           ["all", "All rows (" + store.table().rows.length + ")"],
           ["selection", "Selection (" + (sel.rows.length * sel.fields.length) + " cells)"]].forEach(function (pair) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "tablify-btn" + (opts.scope === pair[0] ? " is-on" : "");
            b.textContent = pair[1];
            b.disabled = pair[0] === "selection" && (!sel.rows.length || !sel.fields.length);
            b.addEventListener("click", function () { opts.scope = pair[0]; draw(); });
            scopes.appendChild(b);
          });
          body.appendChild(row("What to export", scopes));

          var cb = document.createElement("input");
          cb.type = "checkbox"; cb.className = "ob-check"; cb.checked = opts.header;
          cb.addEventListener("change", function () { opts.header = cb.checked; });
          body.appendChild(row("Include a header row", cb));

          var hidden = document.createElement("input");
          hidden.type = "checkbox"; hidden.className = "ob-check"; hidden.checked = opts.includeHidden;
          hidden.addEventListener("change", function () { opts.includeHidden = hidden.checked; });
          body.appendChild(row("Include hidden fields", hidden));

          var note = document.createElement("div");
          note.className = "ob-hint";
          note.textContent = opts.format === "xlsx"
            ? "The .xlsx is generated here — a stored-entry ZIP with inline strings. Excel, Numbers and LibreOffice open it."
            : "Text formats are UTF-8. Values are written plain, not formatted.";
          body.appendChild(note);
        }
        draw();
      },
      foot: function (foot, m) {
        foot.appendChild(btn("Cancel", null, function () { m.close(); }));
        foot.appendChild(btn("Export", "primary", function () { run(); m.close(); }));
      },
    });

    function run() {
      var fields = opts.includeHidden ? store.table().fields : store.visibleFields();
      var rows;
      if (opts.scope === "all") rows = store.table().rows;
      else if (opts.scope === "selection") { rows = sel.rows; fields = sel.fields; }
      else rows = grid.rowItems().map(function (it) { return it.row; });
      var matrix = IO.matrixFor(fields, rows, opts.header);
      var base = store.table().name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (opts.format === "csv") IO.download(base + ".csv", IO.toCSV(matrix), "text/csv;charset=utf-8");
      else if (opts.format === "tsv") {
        IO.copyText(IO.toTSV(matrix));
        TF.toast.show("Copied " + rows.length + " rows as TSV");
        return;
      } else if (opts.format === "xlsx") IO.download(base + ".xlsx", IO.buildXlsx(matrix), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      else if (opts.format === "md") IO.download(base + ".md", IO.toMarkdown(fields, rows), "text/markdown;charset=utf-8");
      else IO.download(base + ".json", IO.toJSON(fields, rows), "application/json");
      TF.toast.show("Exported " + rows.length + " rows as " + opts.format.toUpperCase());
    }
  }

  /* ── sync: pull, push, conflicts ───────────────────────────────────────── */
  function syncPanel(ctx) {
    var store = ctx.store, grid = ctx.grid;
    var st = store.get().syncState;
    var diff = TF.sync.computeDiff(store.table(), st);
    var resolutions = {};

    modal({
      title: "Sync with this base",
      xl: true,
      subtitle: st.link ? st.link.baseName + " / " + st.link.tableName + " · " + diff.stats.recordCount + " records upstream" : "Not linked yet",
      body: function (body, m) {
        function draw() {
          body.innerHTML = "";
          if (!store.get().syncState.link) {
            var intro = document.createElement("p");
            intro.className = "dlg-preview";
            intro.textContent = "No base is linked. Linking is a one-time, per-view step: the plugin remembers one base + table per view, " +
              "imports it lazily, and never writes to the upstream schema.";
            body.appendChild(intro);
            var warn = document.createElement("div");
            warn.className = "ob-banner is-warn";
            warn.textContent = "The prototype links to fixture data, so the diff, review and error paths behave exactly like the real thing.";
            body.appendChild(warn);
            return;
          }
          store.setSyncUI({ pending: diff });

          var stats = document.createElement("div");
          stats.className = "dlg-stats";
          [[diff.stats.toPull, "field(s) to pull"], [diff.stats.toPush, "field(s) to push"], [diff.stats.conflicts, "conflicts"], [diff.stats.newRows, "new row(s) upstream"], [diff.stats.skippedFields, "fields with no counterpart"]].forEach(function (pair) {
            var s = document.createElement("div");
            s.className = "dlg-stat";
            s.innerHTML = '<span class="dlg-stat-num">' + pair[0] + '</span><span class="dlg-stat-lbl">' + pair[1] + "</span>";
            stats.appendChild(s);
          });
          body.appendChild(stats);

          var seg = document.createElement("div");
          seg.className = "tablify-seg";
          var b1 = btn("Pull " + diff.stats.toPull + " change(s)", null, function () {
            if (!diff.stats.toPull) { TF.toast.show("Nothing to pull"); return; }
            runPull(b1);
          });
          b1.className = "tablify-btn";
          var b2 = btn("Push " + diff.stats.toPush + " change(s)", null, function () {
            if (!diff.stats.toPush) { TF.toast.show("Nothing to push"); return; }
            runPush(b2);
          });
          b2.className = "tablify-btn";
          var b3 = btn("Review " + (diff.stats.conflicts + diff.stats.toPull + diff.stats.toPush) + " change(s)…", null, function () { reviewDialog(); });
          b3.className = "tablify-btn";
          seg.appendChild(b1); seg.appendChild(b2); seg.appendChild(b3);
          body.appendChild(seg);

          var bar = document.createElement("div");
          bar.className = "tablify-bar";
          var fl = document.createElement("label");
          fl.className = "ob-hint";
          var fc = document.createElement("input");
          fc.type = "checkbox"; fc.className = "ob-check"; fc.checked = !!store.get().syncState.failNext;
          fc.addEventListener("change", function () { store.setSyncUI({ failNext: fc.checked }); });
          fl.appendChild(fc);
          fl.appendChild(document.createTextNode(" Simulate a failed request (429 after retries)"));
          bar.appendChild(fl);
          bar.appendChild(document.createTextNode(" "));
          body.appendChild(bar);

          var skipped = document.createElement("div");
          skipped.className = "ob-hint";
          skipped.textContent = diff.skipped.length
            ? "No counterpart upstream: " + diff.skipped.map(function (f) { return f.name; }).join(", ") + " — never sent, reported every time."
            : "Every field has a counterpart upstream.";
          body.appendChild(skipped);

          var log = document.createElement("div");
          log.className = "dlg-scroll";
          var stNow = store.get().syncState;
          if (stNow.lastPull || stNow.lastPush) {
            var line = document.createElement("div");
            line.className = "sync-state";
            line.textContent = "Last pull " + timeAgo(stNow.lastPull) + " · last push " + timeAgo(stNow.lastPush);
            log.appendChild(line);
          }
          stNow.log.slice().reverse().forEach(function (entry) {
            var l = document.createElement("div");
            l.className = "dlg-mono";
            l.textContent = new Date(entry.at).toLocaleTimeString() + "  " + entry.text;
            log.appendChild(l);
          });
          if (!stNow.log.length) {
            var none = document.createElement("div");
            none.className = "ob-hint";
            none.textContent = "No sync activity yet in this session.";
            log.appendChild(none);
          }
          body.appendChild(log);
        }

        function runPull(target) {
          var progress = document.createElement("span");
          progress.className = "ob-hint";
          progress.textContent = " pulling…";
          target.after(progress);
          progress.className = "progress";
          progress.innerHTML = '<span class="progress-fill" style="width:60%"></span>';
          TF.sync.simulate({ latency: 500, fail: store.get().syncState.failNext }).then(function () {
            var changes = TF.sync.buildPullChanges(diff, null);
            store.applyPull(changes);
            store.setSyncUI({ snapshot: TF.sync.computeNextSnapshot(store.table(), store.get().syncState, null) });
            grid.render();
            TF.toast.show("Pulled " + changes.length + " change(s)");
            m.close(); syncPanel(ctx);
          }).catch(function (err) {
            progress.remove();
            var banner = document.createElement("div");
            banner.className = "ob-banner is-warn";
            banner.textContent = err.message + " — nothing was applied. Retry, or keep working; the plugin queues writes instead of losing them.";
            body.prepend(banner);
          });
        }
        function runPush(target) {
          var progress = document.createElement("div");
          progress.className = "progress";
          progress.innerHTML = '<span class="progress-fill" style="width:55%"></span>';
          target.after(progress);
          TF.sync.simulate({ latency: 500, fail: store.get().syncState.failNext }).then(function () {
            var writes = TF.sync.buildPushChanges(diff, resolutions);
            store.applyPush(writes);
            store.setSyncUI({ snapshot: TF.sync.computeNextSnapshot(store.table(), store.get().syncState, null) });
            grid.render();
            TF.toast.show("Pushed " + writes.length + " change(s)");
            m.close(); syncPanel(ctx);
          }).catch(function (err) {
            progress.remove();
            var banner = document.createElement("div");
            banner.className = "ob-banner is-warn";
            banner.textContent = err.message + " — the local rows are unchanged and the push can be retried.";
            body.prepend(banner);
          });
        }
        function reviewDialog() {
          modal({
            title: "Review changes",
            xl: true,
            subtitle: "Conflicts are never resolved silently. Pick a side per field.",
            body: function (body2) {
              function draw2() {
                body2.innerHTML = "";
                if (!diff.conflicts.length && !diff.pulls.length && !diff.pushes.length) {
                  var ok = document.createElement("div");
                  ok.className = "dlg-preview";
                  ok.textContent = "Everything is in sync. Nothing to review.";
                  body2.appendChild(ok);
                  return;
                }
                diff.conflicts.forEach(function (c) {
                  var fields = store.table().fields;
                  var head = document.createElement("div");
                  head.className = "dlg-conflict-head";
                  var row = store.rowById(c.rowId);
                  var primary = fields[0];
                  head.textContent = "Conflict · " + (row ? D.formatCell(primary, row.cells[primary.id]).text : c.rowId) + " · " + c.recordId;
                  body2.appendChild(head);
                  Object.keys(c.fields).forEach(function (fid) {
                    var f = store.fieldById(fid);
                    if (!f) return;
                    var line = document.createElement("div");
                    line.className = "dlg-conflict-row is-conflict";
                    line.style.display = "grid";
                    line.style.gridTemplateColumns = "1fr 1fr 1fr";
                    ["", "Local (this vault)", "Remote (upstream)"].forEach(function (t, i) {
                      var s = document.createElement("span");
                      s.textContent = i === 0 ? f.name : t;
                      if (i === 0) s.className = "ob-field-label";
                      line.appendChild(s);
                    });
                    ["local", "remote"].forEach(function (side) {
                      var chip = document.createElement("button");
                      chip.type = "button";
                      chip.className = "tablify-btn" + ((resolutions[c.recordId] || {})[fid] === side ? " is-on" : "");
                      chip.textContent = D.formatCell(f, c.fields[fid][side]).text || "empty";
                      chip.addEventListener("click", function () {
                        resolutions[c.recordId] = resolutions[c.recordId] || {};
                        resolutions[c.recordId][fid] = side;
                        draw2();
                      });
                      line.appendChild(chip);
                    });
                    var base = document.createElement("span");
                    base.className = "ob-hint";
                    base.textContent = "was: " + (D.formatCell(f, c.fields[fid].base).text || "empty");
                    line.appendChild(base);
                    body2.appendChild(line);
                  });
                });
                if (diff.pulls.length) {
                  var ph = document.createElement("div");
                  ph.className = "dlg-conflict-head";
                  ph.textContent = "Incoming from remote (" + diff.pulls.length + ")";
                  body2.appendChild(ph);
                  diff.pulls.forEach(function (c) {
                    var line = document.createElement("div");
                    line.className = "dlg-conflict-row";
                    var row = c.rowId ? store.rowById(c.rowId) : null;
                    var fields = store.table().fields;
                    var label = c.kind === "new" ? "New record " + c.remoteId : (row ? D.formatCell(fields[0], row.cells[fields[0].id]).text : c.rowId);
                    var details = Object.keys(c.fields || {}).map(function (fid) {
                      var f = store.fieldById(fid);
                      return f ? f.name + " → " + (D.formatCell(f, c.fields[fid]).text || "empty") : "";
                    }).filter(Boolean).join(" · ");
                    line.textContent = label + (details ? "  ·  " + details : (c.kind === "new" ? "  ·  will be added as a note" : ""));
                    body2.appendChild(line);
                  });
                }
                if (diff.pushes.length) {
                  var qh = document.createElement("div");
                  qh.className = "dlg-conflict-head";
                  qh.textContent = "Going upstream (" + diff.pushes.length + ")";
                  body2.appendChild(qh);
                  diff.pushes.forEach(function (c) {
                    var line = document.createElement("div");
                    line.className = "dlg-conflict-row is-changed";
                    var row = store.rowById(c.rowId);
                    var fields = store.table().fields;
                    var label = c.kind === "create" ? "New record for " + (row ? D.formatCell(fields[0], row.cells[fields[0].id]).text : c.rowId) : (row ? D.formatCell(fields[0], row.cells[fields[0].id]).text : c.rowId);
                    var details = Object.keys(c.fields || {}).map(function (fid) {
                      var f = store.fieldById(fid);
                      return f ? f.name + " = " + (D.formatCell(f, c.fields[fid]).text || "empty") : "";
                    }).filter(Boolean).join(" · ");
                    line.textContent = label + (details ? "  ·  " + details : "");
                    body2.appendChild(line);
                  });
                }
              }
              draw2();
            },
            foot: function (foot2, m2) {
              foot2.appendChild(btn("Apply my choices", "primary", function () {
                var writes = TF.sync.buildPushChanges(diff, resolutions);
                var pulls = TF.sync.conflictPulls(diff, resolutions);
                if (writes.length) store.applyPush(writes);
                if (pulls.length) store.applyPull(pulls);
                store.setSyncUI({ snapshot: TF.sync.computeNextSnapshot(store.table(), store.get().syncState, resolutions) });
                TF.toast.show("Resolved " + Object.keys(resolutions).length + " record(s)");
                m2.close(); m.close(); grid.render(); syncPanel(ctx);
              }));
              foot2.appendChild(btn("Keep local everywhere", null, function () {
                diff.conflicts.forEach(function (c) {
                  resolutions[c.recordId] = {};
                  Object.keys(c.fields).forEach(function (fid) { resolutions[c.recordId][fid] = "local"; });
                });
                var writes = TF.sync.buildPushChanges(diff, resolutions);
                store.applyPush(writes);
                TF.toast.show("Kept local values for " + diff.conflicts.length + " record(s)");
                m2.close(); m.close(); grid.render(); syncPanel(ctx);
              }));
            },
          });
        }
        draw();
      },
      foot: function (foot, m) {
        if (st.link) {
          foot.appendChild(btn("Unlink", null, function () {
            confirm({ title: "Unlink this base?", message: "The rows stay in your vault; only the link is removed.", confirmLabel: "Unlink", danger: true }).then(function (ok) {
              if (!ok) return;
              store.unlinkSync(); m.close(); grid.render();
            });
          }));
        } else {
          foot.appendChild(btn("Link the demo base", "primary", function () {
            TF.sync.seedDemo(store);
            m.close(); grid.render(); syncPanel(ctx);
          }));
        }
        foot.appendChild(btn("Close", null, function () { m.close(); }));
      },
    });
  }
  function timeAgo(iso) {
    if (!iso) return "never";
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  /* ── keyboard help ─────────────────────────────────────────────────────── */
  function keyboardHelp() {
    var groups = [
      ["Move", [["↑ ↓ ← →", "Move the active cell"], ["Shift + arrows", "Extend the selection"], ["Page Up / Down", "Jump a screen"], ["Home / End", "First / last column"], ["Tab / Shift+Tab", "Next / previous cell"]]],
      ["Edit", [["Enter or F2", "Edit the active cell"], ["Any letter", "Replace and start typing"], ["Space", "Toggle a checkbox"], ["Delete / Backspace", "Clear the selection"], ["Ctrl + Enter", "Edit and keep the selection"]]],
      ["Blocks", [["Ctrl + C / X", "Copy or cut the block"], ["Ctrl + V", "Paste from the clipboard"], ["Ctrl + D or Alt + D", "Fill down"], ["Ctrl + R or Alt + R", "Fill right"], ["Ctrl + A", "Select all"], ["Ctrl + Z / Y", "Undo / redo"]]],
      ["Touch", [["Long press a cell", "Open the cell menu"], ["Long press a header", "Sort, filter, hide, edit"], ["Drag a row handle", "Reorder the row"], ["Drag a column edge", "Resize the column"]]],
      ["Surfaces", [["Esc", "Close the menu, the popover or the dialog"], ["F1 or ?", "This help"]]],
    ];
    modal({
      title: "Keyboard & touch",
      wide: true,
      subtitle: "Matches the committed Playwright keyboard spec — the tests press these exact keys.",
      body: function (body) {
        groups.forEach(function (g) {
          var h = document.createElement("h4");
          h.className = "ob-field-label";
          h.textContent = g[0];
          body.appendChild(h);
          var grid = document.createElement("div");
          grid.className = "kbd-grid";
          g[1].forEach(function (pair) {
            var k = document.createElement("span");
            k.className = "kbd";
            k.textContent = pair[0];
            var v = document.createElement("span");
            v.textContent = pair[1];
            grid.appendChild(k); grid.appendChild(v);
          });
          body.appendChild(grid);
        });
      },
      foot: function (foot, m) { foot.appendChild(btn("Close", "primary", function () { m.close(); })); },
    });
  }

  return {
    modal: modal, confirm: confirm, prompt: prompt, btn: btn, row: row,
    filterPanel: filterPanel, sortPanel: sortPanel, groupPanel: groupPanel, hidePanel: hidePanel,
    queryPanel: filterPanel, viewPanel: viewPanel, fieldConfig: fieldConfig, optionManager: optionManager,
    cellMenu: cellMenu, headerMenu: headerMenu, gutterMenu: gutterMenu, rowDetails: rowDetails,
    pasteBlockDialog: pasteBlockDialog, importWizard: importWizard, exportDialog: exportDialog,
    syncPanel: syncPanel, tabulaDryRun: tabulaDryRun, keyboardHelp: keyboardHelp,
    readSpreadsheet: readSpreadsheet, autoWidth: autoWidth,
  };
})();
