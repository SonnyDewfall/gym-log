(function () {
"use strict";
var CFG = window.GYMLOG_CONFIG || {};
var S = { tab: "today", draft: null, editDraft: null, openHist: {}, timer: null };
var $main = document.getElementById("main");
var $status = document.getElementById("status");

var store = new window.GymStore.Store({
  clientId: (CFG.googleClientId || "").trim(),
  onChange: function () { refreshDraftFromStore(); render(); },
  onStatus: function () { renderStatus(); if (S.tab === "sync") render(); }
});

function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function num(v) { var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function todayISO() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function fmtDate(iso) { try { return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); } catch (e) { return iso; } }
function fmtTime(ms) { try { return new Date(ms).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function note(t, err) { $status.textContent = t || ""; $status.className = "status" + (err ? " err" : ""); }

function workouts() {
  return store.list("workouts").sort(function (a, b) { return (a.day - b.day) || ((a.order || 0) - (b.order || 0)) || String(a.name).localeCompare(String(b.name)); });
}
function sessions() { return store.list("sessions").sort(function (a, b) { return (b.startedAt || 0) - (a.startedAt || 0); }); }

/* ---------- formatting ---------- */
function repText(ex) {
  var u = ex.unit === "secs" ? "s" : "";
  var r = (ex.repMin != null && ex.repMax != null && ex.repMin !== ex.repMax) ? (ex.repMin + "–" + ex.repMax) : (ex.repMax != null ? ex.repMax : (ex.repMin != null ? ex.repMin : "?"));
  return r + u + (ex.perSide ? "/side" : "");
}
function targetText(ex) {
  var p = [(ex.sets || 0) + " × " + repText(ex)];
  if (ex.weight != null && ex.weight !== "") p.push(ex.weight + " kg");
  if (ex.rest) p.push("rest " + ex.rest + "s");
  return p.join(" · ");
}
function targetReps(ex) { return ex.repMax != null ? ex.repMax : ex.repMin; }
function groupsOf(list) {
  var out = [], cur = null;
  (list || []).forEach(function (ex, i) {
    if (ex.group) { if (cur && cur.group === ex.group) cur.items.push({ ex: ex, i: i }); else { cur = { group: ex.group, items: [{ ex: ex, i: i }] }; out.push(cur); } }
    else { cur = null; out.push({ group: null, items: [{ ex: ex, i: i }] }); }
  });
  return out;
}

/* ---------- session persistence ---------- */
var saveT = null;
function saveDraft(now) {
  if (saveT) { clearTimeout(saveT); saveT = null; }
  if (!S.draft) return;
  var go = function () { var d = clone(S.draft); store.put("sessions", d.id, d); S.draft.updatedAt = store.data.sessions[d.id].updatedAt; };
  if (now) go(); else saveT = setTimeout(go, 500);
}
function openSession() { return sessions().filter(function (s) { return !s.finishedAt; })[0] || null; }
function refreshDraftFromStore() {
  if (!S.draft) { var o = openSession(); if (o) S.draft = o; return; }
  var r = store.data.sessions[S.draft.id];
  if (!r || r.deleted) { S.draft = null; return; }
  if ((r.updatedAt || 0) > (S.draft.updatedAt || 0) && !isTyping()) { var id = S.draft.id; S.draft = clone(r); S.draft.id = id; }
}
function isTyping() { var a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $main.contains(a); }

/* ---------- status ---------- */
function renderStatus() {
  var st = store.state, map = {
    local: ["Saved on phone", ""], synced: ["Synced to Drive", "ok"], pending: ["Changes waiting to sync", ""],
    syncing: ["Syncing…", ""], offline: ["Offline · saved on phone", "warn"], signin: ["Tap Sync to sign in", "warn"], error: ["Sync problem", "warn"], idle: ["", ""]
  };
  var m = map[st] || ["", ""];
  var b = document.getElementById("tab-sync");
  b.textContent = st === "synced" ? "Sync ✓" : (st === "signin" || st === "error" || st === "offline") ? "Sync !" : "Sync";
  if (st === "error") note(store.detail, true);
  else if ($status.className.indexOf("err") >= 0) note("");
  return m;
}

/* ---------- render ---------- */
function render() {
  ["today", "plan", "history", "sync"].forEach(function (t) { var b = document.getElementById("tab-" + t); if (t === S.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (isTyping()) return;
  var h;
  if (S.tab === "today") h = S.draft ? renderSession() : renderPicker();
  else if (S.tab === "plan") h = S.editDraft ? renderEditor() : renderPlan();
  else if (S.tab === "history") h = renderHistory();
  else h = renderSync();
  $main.innerHTML = h;
}
function lastFinished() { return sessions().filter(function (s) { return s.finishedAt; })[0]; }
function suggestedDay() { var l = lastFinished(); return (!l || !l.day) ? 1 : ((l.day % 3) + 1); }
function dayList(ws) { var s = {}; ws.forEach(function (w) { s[w.day] = 1; }); return Object.keys(s).map(Number).sort(function (a, b) { return a - b; }); }

function renderPicker() {
  var ws = workouts();
  if (!ws.length) return '<div class="card"><h2>No workouts yet</h2><p class="muted">Add one under Plan, or sync with Google Drive to load your programme.</p></div>';
  var sug = suggestedDay(), l = lastFinished();
  var h = '<section><div class="card"><h2>Pick today\'s session</h2><div class="muted small">' + (l ? ('Last: ' + esc(l.workoutName) + ' on ' + esc(fmtDate(l.date)) + '. ') : '') + 'Day ' + sug + ' is next in the rotation.</div></div>';
  dayList(ws).forEach(function (day) {
    var list = ws.filter(function (w) { return w.day === day; });
    h += '<div class="sec-h"><h2>Day ' + day + '</h2>' + (day === sug ? '<span class="pill accent">Next up</span>' : '') + '</div>';
    list.forEach(function (w) {
      h += '<div class="card wo"><div class="grow"><h3>' + esc(w.name) + '</h3><div class="muted small">' + esc(w.variant || "") + (w.variant ? ' · ' : '') + (w.exercises || []).length + ' exercises</div></div>' +
        '<button class="btn primary" data-action="start" data-id="' + esc(w.id) + '">Start</button></div>';
    });
  });
  return h + '</section>';
}

function renderSession() {
  var s = S.draft, done = 0, total = 0;
  (s.exercises || []).forEach(function (ex) { (ex.sets || []).forEach(function (st) { total++; if (st.done) done++; }); });
  var h = '<section><div class="card"><div class="row"><div class="grow"><h2>' + esc(s.workoutName) + '</h2><div class="muted small">' + esc(fmtDate(s.date)) + (s.variant ? ' · ' + esc(s.variant) : '') + ' · ' + done + '/' + total + ' sets done</div></div>' +
    (s.finishedAt ? '<span class="pill done">Finished</span>' : '') + '</div>';
  if (s.warmup) h += '<div class="cue"><strong>Warm-up:</strong> ' + esc(s.warmup) + '</div>';
  h += '</div>';
  groupsOf(s.exercises).forEach(function (g) {
    if (g.group) {
      h += '<div class="ss"><div class="group-label">Superset ' + esc(g.group) + ' · do back-to-back</div>';
      g.items.forEach(function (it, k) { h += renderExCard(it.ex, it.i, g.group + (k + 1)); });
      h += '</div>';
    } else h += renderExCard(g.items[0].ex, g.items[0].i, null);
  });
  h += '<label class="f" for="sess-note">Session notes<textarea id="sess-note" data-field="sessnote" placeholder="Energy, sleep, anything that felt off">' + esc(s.note || "") + '</textarea></label>';
  h += '<div class="row">' + (s.finishedAt ? '<button class="btn primary grow" data-action="close">Done</button>' : '<button class="btn primary grow" data-action="finish">Finish workout</button>') +
    '<button class="btn danger" data-action="discard">' + (s.finishedAt ? 'Delete' : 'Discard') + '</button></div>';
  return h + '</section>';
}
function renderExCard(ex, i, tag) {
  var allDone = (ex.sets || []).length && ex.sets.every(function (st) { return st.done; });
  var unitLbl = ex.unit === "secs" ? "Secs" : "Reps";
  var h = '<div class="card ex" id="ex-' + i + '"><div class="row"><div class="grow"><h3>' + (tag ? '<span class="pill">' + esc(tag) + '</span> ' : '') + esc(ex.name) + '</h3>' +
    '<div class="target">' + esc(targetText(ex)) + '</div></div>' + (allDone ? '<span class="pill done">Done</span>' : '') + '</div>';
  if (ex.cue) h += '<div class="cue">' + esc(ex.cue) + '</div>';
  if (ex.last) h += '<div class="cue">Last time: ' + esc(ex.last) + '</div>';
  if (!allDone) {
    var w = (ex.weight != null && ex.weight !== "") ? (' @ ' + ex.weight + ' kg') : '';
    h += '<button class="btn ok full" data-action="quick" data-i="' + i + '">✓ Did it: ' + (ex.sets || []).length + ' × ' + esc(targetReps(ex)) + (ex.unit === "secs" ? 's' : '') + w + '</button>';
  }
  h += '<div class="sets"><div class="set-head"><span>Set</span><span>kg</span><span>' + unitLbl + '</span><span></span></div>';
  (ex.sets || []).forEach(function (st, j) {
    h += '<div class="set' + (st.done ? ' is-done' : '') + '"><span class="n">' + (j + 1) + '</span>' +
      '<input id="w-' + i + '-' + j + '" inputmode="decimal" aria-label="Set ' + (j + 1) + ' weight in kg" placeholder="' + esc(ex.weight != null ? ex.weight : "–") + '" value="' + esc(st.w != null ? st.w : "") + '" data-field="w" data-i="' + i + '" data-j="' + j + '">' +
      '<input id="r-' + i + '-' + j + '" inputmode="numeric" aria-label="Set ' + (j + 1) + ' ' + unitLbl.toLowerCase() + '" placeholder="' + esc(targetReps(ex)) + '" value="' + esc(st.r != null ? st.r : "") + '" data-field="r" data-i="' + i + '" data-j="' + j + '">' +
      '<button class="tick" data-action="tick" data-i="' + i + '" data-j="' + j + '" aria-pressed="' + (st.done ? 'true' : 'false') + '" aria-label="Mark set ' + (j + 1) + ' done">✓</button></div>';
  });
  h += '</div><div class="row"><button class="btn ghost small" data-action="addset" data-i="' + i + '">+ Set</button>' +
    ((ex.sets || []).length > 1 ? '<button class="btn ghost small" data-action="rmset" data-i="' + i + '">− Set</button>' : '') + '</div>';
  h += '<label class="f" for="note-' + i + '">Notes<textarea id="note-' + i + '" data-field="note" data-i="' + i + '" placeholder="How it felt, form, pain, machine settings">' + esc(ex.note || "") + '</textarea></label>';
  return h + '</div>';
}

function renderPlan() {
  var ws = workouts();
  var h = '<section><div class="card"><div class="row"><div class="grow"><h2>Programme</h2><div class="muted small">Each day has variations to pick from. Tap Edit to change one.</div></div><button class="btn" data-action="newwo">+ New</button></div></div>';
  if (!ws.length) h += '<div class="empty">No workouts yet.</div>';
  dayList(ws).forEach(function (day) {
    var list = ws.filter(function (w) { return w.day === day; });
    h += '<div class="sec-h"><h2>Day ' + day + '</h2><span class="sub">' + list.length + ' variation' + (list.length > 1 ? 's' : '') + '</span></div>';
    list.forEach(function (w) {
      h += '<div class="card"><div class="row"><div class="grow"><h3>' + esc(w.name) + '</h3><div class="muted small">' + esc(w.variant || "") + '</div></div><button class="btn" data-action="edit" data-id="' + esc(w.id) + '">Edit</button></div>';
      groupsOf(w.exercises).forEach(function (g) {
        g.items.forEach(function (it, k) { h += '<div class="hist-line">' + (g.group ? '<span class="pill">' + esc(g.group + (k + 1)) + '</span> ' : '') + '<strong>' + esc(it.ex.name) + '</strong> <span class="muted">' + esc(targetText(it.ex)) + '</span></div>'; });
      });
      h += '</div>';
    });
  });
  return h + '</section>';
}
function fld(k, label, v, i, mode) { return '<label class="f" for="x-' + k + '-' + i + '">' + label + '<input id="x-' + k + '-' + i + '" inputmode="' + mode + '" data-xfield="' + k + '" data-i="' + i + '" value="' + esc(v == null ? "" : v) + '"></label>'; }
function renderEditor() {
  var w = S.editDraft;
  var h = '<section><div class="card"><h2>' + (w._new ? 'New workout' : 'Edit workout') + '</h2>' +
    '<div class="grid2"><label class="f" for="e-name">Name<input id="e-name" data-efield="name" value="' + esc(w.name) + '"></label>' +
    '<label class="f" for="e-day">Day<select id="e-day" data-efield="day">' + [1, 2, 3, 4, 5, 6, 7].map(function (d) { return '<option value="' + d + '"' + (w.day === d ? ' selected' : '') + '>Day ' + d + '</option>'; }).join('') + '</select></label></div>' +
    '<label class="f" for="e-variant">Variation label<input id="e-variant" data-efield="variant" value="' + esc(w.variant || "") + '" placeholder="e.g. Week 2 · Tempo"></label>' +
    '<label class="f" for="e-warmup">Warm-up<textarea id="e-warmup" data-efield="warmup">' + esc(w.warmup || "") + '</textarea></label></div>';
  (w.exercises || []).forEach(function (ex, i) {
    h += '<div class="card"><div class="row"><strong class="grow">' + (i + 1) + '. ' + esc(ex.name || "New exercise") + '</strong>' +
      '<button class="btn ghost" data-action="exup" data-i="' + i + '" aria-label="Move up">↑</button>' +
      '<button class="btn ghost" data-action="exdown" data-i="' + i + '" aria-label="Move down">↓</button>' +
      '<button class="btn ghost danger" data-action="exdel" data-i="' + i + '" aria-label="Remove exercise">✕</button></div>' +
      '<label class="f" for="x-name-' + i + '">Exercise<input id="x-name-' + i + '" data-xfield="name" data-i="' + i + '" value="' + esc(ex.name || "") + '"></label>' +
      '<div class="grid4">' + fld("sets", "Sets", ex.sets, i, "numeric") + fld("repMin", "Min", ex.repMin, i, "numeric") + fld("repMax", "Max", ex.repMax, i, "numeric") + fld("weight", "kg", ex.weight, i, "decimal") +
      fld("rest", "Rest (s)", ex.rest, i, "numeric") + fld("group", "Superset", ex.group, i, "text") +
      '<label class="f" for="x-unit-' + i + '">Counts<select id="x-unit-' + i + '" data-xfield="unit" data-i="' + i + '"><option value="reps"' + (ex.unit !== "secs" ? ' selected' : '') + '>Reps</option><option value="secs"' + (ex.unit === "secs" ? ' selected' : '') + '>Seconds</option></select></label>' +
      '<label class="check" for="x-side-' + i + '"><input type="checkbox" id="x-side-' + i + '" data-xfield="perSide" data-i="' + i + '"' + (ex.perSide ? ' checked' : '') + '> Per side</label></div>' +
      '<label class="f" for="x-cue-' + i + '">Cue<input id="x-cue-' + i + '" data-xfield="cue" data-i="' + i + '" value="' + esc(ex.cue || "") + '"></label></div>';
  });
  h += '<button class="btn full" data-action="exadd">+ Add exercise</button>';
  h += '<div class="row"><button class="btn primary grow" data-action="esave">Save</button><button class="btn" data-action="ecancel">Cancel</button></div>';
  if (!w._new) h += '<div class="row"><button class="btn grow" data-action="edup">Save as new variation</button><button class="btn danger" data-action="edel">Delete</button></div>';
  return h + '</section>';
}

function renderHistory() {
  var fin = sessions().filter(function (s) { return s.finishedAt; });
  var h = '<section><div class="card"><h2>History</h2><div class="muted small">' + fin.length + ' finished session' + (fin.length === 1 ? '' : 's') + '. Tap one to see or edit it.</div></div>';
  if (!fin.length) h += '<div class="empty">Nothing logged yet.</div>';
  fin.forEach(function (s) {
    var open = !!S.openHist[s.id];
    h += '<div class="card"><button class="btn ghost full" style="text-align:left;border:0;padding:0;min-height:0" data-action="hist" data-id="' + esc(s.id) + '" aria-expanded="' + open + '"><div class="row"><div class="grow"><h3>' + esc(s.workoutName) + '</h3><div class="muted small">' + esc(fmtDate(s.date)) + (s.variant ? ' · ' + esc(s.variant) : '') + '</div></div><span class="muted">' + (open ? '▲' : '▼') + '</span></div></button>';
    if (open) {
      (s.exercises || []).forEach(function (ex) {
        h += '<div class="hist-line"><strong>' + esc(ex.name) + '</strong>: ' + (setsSummary(ex) || '<span class="muted">skipped</span>') + '</div>';
        if (ex.note) h += '<div class="hist-note">' + esc(ex.note) + '</div>';
      });
      if (s.note) h += '<div class="hist-note">Session: ' + esc(s.note) + '</div>';
      h += '<button class="btn" data-action="reopen" data-id="' + esc(s.id) + '">Edit this session</button>';
    }
    h += '</div>';
  });
  return h + '</section>';
}
function setsSummary(ex) { return esc(setsRaw(ex)); }
function setsRaw(ex) {
  return ((ex.sets || []).filter(function (st) { return st.done || st.r != null; }).map(function (st) { return (st.w != null ? st.w + '×' : '') + (st.r != null ? st.r : '?') + (ex.unit === "secs" ? 's' : ''); }).join(', '));
}

function renderSync() {
  var ready = store.driveReady(), m = store.meta;
  var h = '<section><div class="card"><h2>Google Drive</h2>';
  if (!ready) {
    h += '<p class="muted">Drive sync isn\'t set up yet, so everything is saved on this phone only. Add your Google Client ID to <code>config.js</code> in the GitHub repo to turn it on.</p>';
  } else {
    var lbl = renderStatus()[0];
    h += '<div class="row"><span class="chip ' + (store.state === "synced" ? "ok" : (["signin", "error", "offline"].indexOf(store.state) >= 0 ? "warn" : "")) + '">' + esc(lbl || "Not synced yet") + '</span></div>';
    if (store.detail) h += '<div class="muted small">' + esc(store.detail) + '</div>';
    h += '<div class="muted small">' + (m.lastSync ? 'Last synced ' + esc(fmtTime(m.lastSync)) + '. ' : '') + 'Data file: “' + esc(window.GymStore.FILE_NAME) + '” in your Drive.</div>';
    h += '<button class="btn primary full" data-action="syncnow"' + (store.state === "syncing" ? ' disabled' : '') + '>' + (store.hasToken() ? 'Sync now' : 'Sign in and sync') + '</button>';
  }
  h += '</div><div class="card"><h2>Backup</h2><div class="muted small">A copy of your programme and every session as one file.</div>' +
    '<div class="row"><button class="btn grow" data-action="export">Download backup</button><button class="btn grow" data-action="import">Import a backup</button></div></div>';
  var n = sessions().length, w = workouts().length;
  h += '<div class="muted small">On this phone: ' + w + ' workouts, ' + n + ' sessions.</div>';
  return h + '</section>';
}

/* ---------- actions ---------- */
function lastFor(name, wid) {
  var prev = sessions().filter(function (s) { return s.finishedAt; });
  for (var k = 0; k < prev.length; k++) {
    var ex = (prev[k].exercises || []).filter(function (e) { return e.name === name; })[0];
    if (ex && setsRaw(ex)) return setsRaw(ex) + ' (' + fmtDate(prev[k].date) + ')';
  }
  return "";
}
function startWorkout(id) {
  var w = store.get("workouts", id); if (!w) return;
  var s = { id: "s-" + uid(), workoutId: id, workoutName: w.name, variant: w.variant || "", day: w.day, warmup: w.warmup || "",
    date: todayISO(), startedAt: Date.now(), finishedAt: null, note: "",
    exercises: (w.exercises || []).map(function (ex) {
      var n = Math.max(1, parseInt(ex.sets, 10) || 1), sets = [];
      for (var k = 0; k < n; k++) sets.push({ w: null, r: null, done: false });
      return { name: ex.name, group: ex.group || null, unit: ex.unit || "reps", perSide: !!ex.perSide, sets: sets, repMin: ex.repMin, repMax: ex.repMax, weight: ex.weight, rest: ex.rest || 0, cue: ex.cue || "", last: lastFor(ex.name), note: "" };
    }) };
  S.draft = s; saveDraft(true); render(); window.scrollTo(0, 0);
}
function fillSet(ex, st) {
  if (st.w == null && ex.weight != null && ex.weight !== "") st.w = num(ex.weight);
  if (st.r == null) st.r = num(targetReps(ex));
}
function restAfter(i) {
  var ex = S.draft.exercises[i];
  if (ex.group) { var nx = S.draft.exercises[i + 1]; if (nx && nx.group === ex.group) return 0; }
  return ex.rest || 0;
}
function nextLabel(i) {
  var list = S.draft.exercises, cur = list[i];
  if (cur.group) {
    for (var k = 0; k < list.length; k++) { if (list[k].group === cur.group && list[k].sets.some(function (s) { return !s.done; })) return list[k].name; }
  } else if (cur.sets.some(function (s) { return !s.done; })) return cur.name + " (next set)";
  for (var m = i + 1; m < list.length; m++) { if (list[m].sets.some(function (s) { return !s.done; })) return list[m].name; }
  return "finish up";
}
function startTimer(secs, label) {
  stopTimer(); if (!secs) return;
  S.timer = { end: Date.now() + secs * 1000, label: label, beeped: false };
  ensureAudio(); tickTimer(); S.timer.iv = setInterval(tickTimer, 250);
}
function stopTimer() { if (S.timer && S.timer.iv) clearInterval(S.timer.iv); S.timer = null; var t = document.getElementById("timer"); t.hidden = true; t.innerHTML = ""; t.className = "timer"; }
function tickTimer() {
  var t = document.getElementById("timer"); if (!S.timer) return;
  var left = Math.round((S.timer.end - Date.now()) / 1000), over = left <= 0, a = Math.abs(left);
  var txt = (over ? "+" : "") + Math.floor(a / 60) + ":" + ("0" + (a % 60)).slice(-2);
  if (over && !S.timer.beeped) { S.timer.beeped = true; beep(); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {} }
  t.hidden = false; t.className = "timer" + (over ? " over" : "");
  t.innerHTML = '<div class="timer-inner"><div class="clock">' + txt + '</div><div class="lbl">' + (over ? 'Rest over. Go.' : 'Rest · next: ' + esc(S.timer.label)) + '</div>' +
    '<button data-action="t15">+15s</button><button data-action="tskip">' + (over ? 'Close' : 'Skip') + '</button></div>';
}
var actx = null;
function ensureAudio() { try { if (!actx) { var A = window.AudioContext || window.webkitAudioContext; if (A) actx = new A(); } if (actx && actx.state === "suspended") actx.resume(); } catch (e) {} }
function beep() { try { if (!actx) return; [0, 0.25].forEach(function (dt) { var o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + dt); o.stop(actx.currentTime + dt + 0.15); }); } catch (e) {} }

function confirmBox(msg, okLabel, fn) {
  var root = document.getElementById("modal-root");
  root.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="card"><div>' + esc(msg) + '</div><div class="row"><button class="btn danger grow" id="m-ok">' + esc(okLabel) + '</button><button class="btn grow" id="m-cancel">Cancel</button></div></div></div>';
  document.getElementById("m-cancel").onclick = function () { root.innerHTML = ""; };
  document.getElementById("m-ok").onclick = function () { root.innerHTML = ""; fn(); };
  document.getElementById("m-cancel").focus();
}

function saveWorkout(asNew) {
  var w = clone(S.editDraft), isNew = w._new || asNew; delete w._new;
  w.exercises = (w.exercises || []).filter(function (ex) { return String(ex.name || "").trim(); });
  if (!String(w.name || "").trim()) { note("Give the workout a name.", true); return; }
  var id = isNew ? ("w-" + uid()) : w.id;
  if (asNew) w.order = (w.order || 0) + 1;
  store.put("workouts", id, w);
  S.editDraft = null; note("Saved"); render();
}

function exportBackup() {
  var blob = new Blob([JSON.stringify(store.data, null, 1)], { type: "application/json" });
  var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gym-log-backup-" + todayISO() + ".json";
  document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
document.getElementById("import-file").addEventListener("change", function (e) {
  var f = e.target.files && e.target.files[0]; if (!f) return;
  f.text().then(function (t) {
    var d = JSON.parse(t);
    if (!d || (!d.workouts && !d.sessions)) throw new Error("bad");
    store.replaceAll(d); note("Backup imported and merged.");
  }).catch(function () { note("That file isn't a Gym Log backup.", true); }).then(function () { e.target.value = ""; });
});

document.addEventListener("click", function (e) {
  var b = e.target.closest("[data-action]"); if (!b) return;
  var a = b.getAttribute("data-action"), i = parseInt(b.getAttribute("data-i"), 10), j = parseInt(b.getAttribute("data-j"), 10), id = b.getAttribute("data-id");
  if (document.activeElement && document.activeElement !== b && document.activeElement.blur) document.activeElement.blur();
  var d = S.draft;
  switch (a) {
    case "tab": S.tab = b.getAttribute("data-tab"); render(); window.scrollTo(0, 0); break;
    case "t15": if (S.timer) { S.timer.end += 15000; S.timer.beeped = false; tickTimer(); } break;
    case "tskip": stopTimer(); break;
    case "start": startWorkout(id); break;
    case "tick":
      var ex = d.exercises[i], st = ex.sets[j];
      st.done = !st.done; if (st.done) { fillSet(ex, st); startTimer(restAfter(i), nextLabel(i)); }
      saveDraft(true); render(); break;
    case "quick":
      var ex2 = d.exercises[i]; ex2.sets.forEach(function (st) { fillSet(ex2, st); st.done = true; });
      startTimer(restAfter(i), nextLabel(i)); saveDraft(true); render(); break;
    case "addset": d.exercises[i].sets.push({ w: null, r: null, done: false }); saveDraft(true); render(); break;
    case "rmset": if (d.exercises[i].sets.length > 1) { d.exercises[i].sets.pop(); saveDraft(true); render(); } break;
    case "finish":
      d.finishedAt = Date.now(); saveDraft(true); stopTimer(); S.openHist[d.id] = true; S.draft = null; S.tab = "history"; render(); window.scrollTo(0, 0); store.sync(false); break;
    case "close": saveDraft(true); S.draft = null; S.tab = "history"; render(); break;
    case "discard":
      confirmBox(d.finishedAt ? "Delete this logged session? This can't be undone." : "Discard this session? Anything you logged in it will be lost.", d.finishedAt ? "Delete" : "Discard", function () {
        if (saveT) { clearTimeout(saveT); saveT = null; }
        stopTimer(); store.remove("sessions", d.id); S.draft = null; render();
      }); break;
    case "hist": S.openHist[id] = !S.openHist[id]; render(); break;
    case "reopen":
      var s = store.get("sessions", id); if (!s) return;
      if (S.draft && S.draft.id !== id && !S.draft.finishedAt) { note("Finish or discard your open session first.", true); S.tab = "today"; render(); return; }
      S.draft = clone(s); S.draft.id = id; S.tab = "today"; render(); window.scrollTo(0, 0); break;
    case "newwo": S.editDraft = { _new: true, name: "New workout", day: 1, variant: "", warmup: "", order: Date.now(), exercises: [] }; render(); break;
    case "edit": var w = store.get("workouts", id); if (!w) return; S.editDraft = clone(w); S.editDraft.id = id; render(); window.scrollTo(0, 0); break;
    case "exadd": S.editDraft.exercises.push({ name: "", sets: 3, repMin: 8, repMax: 12, unit: "reps", perSide: false, weight: null, rest: 60, group: null, cue: "" }); render(); break;
    case "exdel": S.editDraft.exercises.splice(i, 1); render(); break;
    case "exup": if (i > 0) { var x = S.editDraft.exercises; x.splice(i - 1, 0, x.splice(i, 1)[0]); render(); } break;
    case "exdown": var y = S.editDraft.exercises; if (i < y.length - 1) { y.splice(i + 1, 0, y.splice(i, 1)[0]); render(); } break;
    case "ecancel": S.editDraft = null; render(); break;
    case "esave": saveWorkout(false); break;
    case "edup": saveWorkout(true); break;
    case "edel": var wid = S.editDraft.id; confirmBox("Delete this workout variation? Logged sessions stay in History.", "Delete", function () { store.remove("workouts", wid); S.editDraft = null; render(); }); break;
    case "syncnow": store.sync(true); break;
    case "export": exportBackup(); break;
    case "import": document.getElementById("import-file").click(); break;
  }
});

document.addEventListener("input", function (e) {
  var t = e.target;
  if (t.hasAttribute("data-field") && S.draft) {
    var f = t.getAttribute("data-field"), i = parseInt(t.getAttribute("data-i"), 10), j = parseInt(t.getAttribute("data-j"), 10);
    if (f === "w") S.draft.exercises[i].sets[j].w = num(t.value);
    else if (f === "r") S.draft.exercises[i].sets[j].r = num(t.value);
    else if (f === "note") S.draft.exercises[i].note = t.value;
    else if (f === "sessnote") S.draft.note = t.value;
    saveDraft(false); return;
  }
  if (S.editDraft) {
    if (t.hasAttribute("data-efield")) { var k = t.getAttribute("data-efield"); S.editDraft[k] = k === "day" ? parseInt(t.value, 10) : t.value; return; }
    if (t.hasAttribute("data-xfield")) {
      var x = S.editDraft.exercises[parseInt(t.getAttribute("data-i"), 10)], key = t.getAttribute("data-xfield");
      if (key === "perSide") x.perSide = t.checked;
      else if (["sets", "repMin", "repMax", "weight", "rest"].indexOf(key) >= 0) x[key] = t.value === "" ? null : num(t.value);
      else if (key === "group") x.group = t.value.trim() ? t.value.trim().toUpperCase() : null;
      else x[key] = t.value;
    }
  }
});
document.addEventListener("change", function (e) { if (e.target.matches("[data-efield],[data-xfield]")) e.target.dispatchEvent(new Event("input", { bubbles: true })); });
document.addEventListener("focusout", function () { setTimeout(function () { if (!isTyping()) { saveDraft(true); render(); } }, 0); });
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") { saveDraft(true); store.sync(false); } });
window.addEventListener("online", function () { store.sync(false); });

/* ---------- start ---------- */
function boot() {
  var seedP = store.isEmpty() ? fetch("seed.json").then(function (r) { return r.json(); }).then(function (seed) { store.data = window.GymStore.merge(store.data, seed); store.saveLocal(); }).catch(function () {}) : Promise.resolve();
  seedP.then(function () {
    refreshDraftFromStore(); render(); renderStatus();
    store.sync(false);
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
}
render(); boot();
})();
