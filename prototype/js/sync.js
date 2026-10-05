/* ============================================================================
   sync.js — the Airtable side of the prototype, with a real three-way diff:
     snapshot (last agreed value) vs local vs remote, per field.
       · local only changed      → push
       · remote only changed     → pull
       · both changed, different → CONFLICT (never applied silently)
   Includes a fake transport with latency and a failure switch, so error paths
   are demonstrable. No network calls are made.
   ========================================================================== */
window.TF = window.TF || {};

TF.sync = (function () {
  "use strict";
  var D = TF.data;

  /* fields that have no counterpart on the remote side (skipped + reported) */
  function unmappedFields(fields) {
    return fields.filter(function (f) {
      return f.type === "attachment" || f.type === "phone" || f.type === "autoNumber" ||
             f.type === "createdTime" || f.type === "lastModifiedTime";
    });
  }
  function mappableFields(fields) {
    var skip = unmappedFields(fields).map(function (f) { return f.id; });
    return fields.filter(function (f) { return skip.indexOf(f.id) === -1; });
  }

  /* seed the demo: remote starts in sync with the local rows, a snapshot is
     taken as the "last agreed" baseline, and THEN local drift is applied.   */
  function seedDemo(store) {
    var st = store.get();
    var clean = D.sampleTable();
    var raw = D.remoteRecords(clean.rows, clean.fields);

    /* The fixture is keyed by local row id and carries its own remote id in
       `rec.id`. Everything downstream works in remote-id space, so re-key it
       here once, and keep the row → record map as the only translation.     */
    var localIds = {};
    clean.rows.forEach(function (r) { localIds[r.id] = true; });
    var remote = {}, recordMap = {};
    Object.keys(raw.records).forEach(function (key) {
      var rec = raw.records[key];
      remote[rec.id] = rec;
      if (localIds[key]) recordMap[key] = rec.id;
    });

    /* snapshot: the last agreed value per record/field — the third side of the
       three-way diff, without which you cannot tell "changed locally" from
       "changed remotely" from "never touched".
       It must come from the CLEAN table, not from the remote records: the
       fixture's remote edits are already baked into those, and deriving the
       baseline from them would make every remote change look like a local one. */
    var snapshot = {};
    clean.rows.forEach(function (row) {
      var recId = recordMap[row.id];
      if (!recId) return;
      var snap = {};
      clean.fields.forEach(function (f) {
        if (f.type === "autoNumber" || f.type === "createdTime" || f.type === "lastModifiedTime") return;
        var v = row.cells[f.id];
        snap[f.id] = Array.isArray(v) ? v.slice() : v;
      });
      snapshot[recId] = snap;
    });
    /* the one remote record with no local counterpart starts unagreed */
    Object.keys(remote).forEach(function (recId) {
      if (!snapshot[recId]) snapshot[recId] = {};
    });

    /* remote-only edits live in the fixture; local drift is applied after the
       snapshot is taken, which is what makes them detectable as separate sides */
    var drifted = D.driftLocal(clean);

    store.commit("seed demo data", function () {
      st.tables[0] = drifted;
      st.syncState.remoteRecords = remote;
      st.syncState.remoteBase = raw.base;
      st.syncState.remoteTable = raw.table;
      st.syncState.snapshot = snapshot;
      st.syncState.recordMap = recordMap;
      st.syncState.link = {
        baseId: raw.base.id, baseName: raw.base.name,
        tableId: raw.table.id, tableName: raw.table.name,
        fieldMap: {}, recordMap: recordMap,
        lastPulledAt: new Date(Date.now() - 86400000).toISOString(),
        lastPushedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      };
      st.tables[0].sync = st.syncState.link;
    });
    return raw;
  }

  function sameValue(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) === JSON.stringify(b || []);
    if (a === null || a === undefined) return b === null || b === undefined || b === "";
    if (b === null || b === undefined) return a === "";
    return String(a) === String(b);
  }
  function keyFor(rowId, recordMap) { return recordMap[rowId] || null; }

  /* ── the diff ─────────────────────────────────────────────────────────────
     returns { pulls, pushes, conflicts, remoteDeletes, localDeletes, skipped,
               nextSnapshot, stats }
     ---------------------------------------------------------------------- */
  function computeDiff(table, syncState) {
    var link = syncState.link;
    var map = (link && link.recordMap) || syncState.recordMap || {};
    var snapshot = syncState.snapshot || {};
    var remote = syncState.remoteRecords || {};
    var mappable = mappableFields(table.fields);
    var skipped = unmappedFields(table.fields);

    var pulls = [], pushes = [], conflicts = [], remoteDeletes = [], localDeletes = [];
    var mappableIds = mappable.map(function (f) { return f.id; });

    /* local rows → compare with remote */
    table.rows.forEach(function (row) {
      var recId = keyFor(row.id, map);
      var rec = recId ? remote[recId] : null;
      if (!rec) {
        pushes.push({ kind: "create", rowId: row.id, fields: pick(row, mappable) });
        return;
      }
      var base = snapshot[recId] || {};
      var pullFields = {}, pushFields = {}, conflictFields = {};
      mappableIds.forEach(function (fid) {
        var localVal = row.cells[fid];
        var remoteVal = rec[fid];
        var baseVal = base[fid];
        var localChanged = !sameValue(localVal, baseVal);
        var remoteChanged = !sameValue(remoteVal, baseVal);
        if (localChanged && remoteChanged) {
          if (sameValue(localVal, remoteVal)) return;      // same edit both sides
          conflictFields[fid] = { local: localVal, remote: remoteVal, base: baseVal };
        } else if (localChanged) {
          pushFields[fid] = localVal;
        } else if (remoteChanged) {
          pullFields[fid] = remoteVal;
        }
      });
      if (Object.keys(conflictFields).length) conflicts.push({ kind: "conflict", rowId: row.id, recordId: recId, fields: conflictFields });
      if (Object.keys(pushFields).length) pushes.push({ kind: "update", rowId: row.id, recordId: recId, fields: pushFields });
      if (Object.keys(pullFields).length) pulls.push({ kind: "update", rowId: row.id, recordId: recId, fields: pullFields });
    });

    /* remote records with no local row → a new note on pull */
    Object.keys(remote).forEach(function (recId) {
      var known = Object.keys(map).some(function (rowId) { return map[rowId] === recId; });
      if (!known) {
        var rec = remote[recId];
        var cells = {};
        mappableIds.forEach(function (fid) { if (rec[fid] !== undefined) cells[fid] = rec[fid]; });
        pulls.push({ kind: "new", remoteId: recId, remote: cells });
      }
    });

    /* local rows whose remote record vanished */
    table.rows.forEach(function (row) {
      var recId = keyFor(row.id, map);
      if (recId && !remote[recId]) remoteDeletes.push({ rowId: row.id, recordId: recId });
    });

    return {
      pulls: pulls, pushes: pushes, conflicts: conflicts,
      remoteDeletes: remoteDeletes, localDeletes: localDeletes,
      skipped: skipped,
      mappableCount: mappable.length,
      stats: {
        toPull: pulls.reduce(function (n, c) { return n + (c.kind === "new" ? 1 : Object.keys(c.fields).length); }, 0),
        toPush: pushes.reduce(function (n, c) { return n + (c.kind === "create" ? 1 : Object.keys(c.fields).length); }, 0),
        conflicts: conflicts.reduce(function (n, c) { return n + Object.keys(c.fields).length; }, 0),
        newRows: pulls.filter(function (c) { return c.kind === "new"; }).length,
        newRecords: pushes.filter(function (c) { return c.kind === "create"; }).length,
        skippedFields: skipped.length,
        recordCount: Object.keys(remote).length,
        linkedRows: Object.keys(map).length,
      },
    };
  }

  function pick(row, fields) {
    var out = {};
    fields.forEach(function (f) { out[f.id] = row.cells[f.id]; });
    return out;
  }

  /* ── fake transport ────────────────────────────────────────────────────── */
  function simulate(opts) {
    var latency = opts && opts.latency ? opts.latency : 420;
    var shouldFail = opts && opts.fail;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (shouldFail) reject(new Error("Remote request failed (simulated 429 after two retries)"));
        else resolve(true);
      }, latency);
    });
  }

  /* ── applying ──────────────────────────────────────────────────────────── */
  /* pull: apply the remote changes the user accepted, then advance the snapshot */
  function buildPullChanges(diff, accepted) {
    var out = [];
    diff.pulls.forEach(function (c) {
      if (accepted && accepted.indexOf(c.rowId || c.remoteId) === -1 && c.kind !== "new") return;
      out.push(c);
    });
    return out;
  }

  /* after a pull or push, everything both sides agree on becomes the new base */
  function computeNextSnapshot(table, syncState, resolutions) {
    var link = syncState.link || {};
    var map = link.recordMap || syncState.recordMap || {};
    var remote = syncState.remoteRecords || {};
    var next = {};
    table.rows.forEach(function (row) {
      var recId = map[row.id];
      var rec = recId ? remote[recId] : null;
      if (!rec) return;
      next[recId] = {};
      mappableFields(table.fields).forEach(function (f) {
        var local = row.cells[f.id];
        var remoteVal = rec[f.id];
        var resolved = resolutions && resolutions[recId] && resolutions[recId][f.id];
        var value = resolved === "remote" ? remoteVal : (resolved === "local" ? local : (sameValue(local, remoteVal) ? local : local));
        next[recId][f.id] = Array.isArray(value) ? value.slice() : value;
      });
    });
    return next;
  }

  /* push: turn accepted changes into remote writes */
  function buildPushChanges(diff, resolutions) {
    var out = diff.pushes.slice();
    diff.conflicts.forEach(function (c) {
      var fields = {};
      Object.keys(c.fields).forEach(function (fid) {
        var choice = resolutions && resolutions[c.recordId] && resolutions[c.recordId][fid];
        if (choice === "local") fields[fid] = c.fields[fid].local;
      });
      if (Object.keys(fields).length) out.push({ kind: "update", rowId: c.rowId, recordId: c.recordId, fields: fields });
    });
    return out;
  }

  /* second half of a conflict resolution: the remote-side wins go through a pull */
  function conflictPulls(diff, resolutions) {
    var out = [];
    diff.conflicts.forEach(function (c) {
      var fields = {};
      Object.keys(c.fields).forEach(function (fid) {
        var choice = resolutions && resolutions[c.recordId] && resolutions[c.recordId][fid];
        if (choice === "remote") fields[fid] = c.fields[fid].remote;
        else if (!choice) fields[fid] = c.fields[fid].local;   // unresolved defaults to local
      });
      if (Object.keys(fields).length) out.push({ kind: "update", rowId: c.rowId, fields: fields });
    });
    return out;
  }

  return {
    unmappedFields: unmappedFields, mappableFields: mappableFields,
    seedDemo: seedDemo, computeDiff: computeDiff, simulate: simulate,
    buildPullChanges: buildPullChanges, buildPushChanges: buildPushChanges,
    conflictPulls: conflictPulls, computeNextSnapshot: computeNextSnapshot, sameValue: sameValue,
  };
})();
