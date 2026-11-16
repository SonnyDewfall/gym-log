// Gym Log data layer: local storage on the phone, merged with a JSON file in Google Drive.
// Every record carries updatedAt (ms). When two copies differ, the newer record wins.
// A deleted record is kept as {deleted: true, updatedAt} so the deletion syncs too.
(function (root) {
  "use strict";

  var LOCAL_KEY = "gymlog.data.v1";
  var META_KEY = "gymlog.meta.v1";
  var FILE_NAME = "Gym Log data.json";
  var SCOPE = "https://www.googleapis.com/auth/drive.file";
  var COLLECTIONS = ["workouts", "sessions"];

  function empty() { return { schema: 1, workouts: {}, sessions: {} }; }

  function normalise(d) {
    var out = empty();
    if (!d || typeof d !== "object") return out;
    COLLECTIONS.forEach(function (c) {
      var src = d[c] || {};
      Object.keys(src).forEach(function (id) {
        var r = src[id];
        if (r && typeof r === "object") out[c][id] = r;
      });
    });
    return out;
  }

  // Newer updatedAt wins per record; ties keep the local copy.
  function merge(local, remote) {
    var a = normalise(local), b = normalise(remote), out = empty();
    COLLECTIONS.forEach(function (c) {
      var ids = {};
      Object.keys(a[c]).forEach(function (k) { ids[k] = 1; });
      Object.keys(b[c]).forEach(function (k) { ids[k] = 1; });
      Object.keys(ids).forEach(function (id) {
        var x = a[c][id], y = b[c][id];
        if (!x) out[c][id] = y;
        else if (!y) out[c][id] = x;
        else out[c][id] = ((y.updatedAt || 0) > (x.updatedAt || 0)) ? y : x;
      });
    });
    return out;
  }

  function same(a, b) { return stable(a) === stable(b); }
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }

  function readJSON(key) { try { var s = root.localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function writeJSON(key, v) { try { root.localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function Store(opts) {
    this.clientId = (opts && opts.clientId) || "";
    this.onChange = (opts && opts.onChange) || function () {};
    this.onStatus = (opts && opts.onStatus) || function () {};
    this.data = normalise(readJSON(LOCAL_KEY));
    this.meta = readJSON(META_KEY) || {};
    this.token = null; this.tokenExp = 0;
    if (this.meta.token && this.meta.tokenExp > Date.now() + 60000) { this.token = this.meta.token; this.tokenExp = this.meta.tokenExp; }
    this.syncing = false; this.again = false; this.timer = null;
    this.state = "idle"; this.detail = "";
  }

  Store.prototype.isEmpty = function () {
    var d = this.data;
    return !Object.keys(d.workouts).length && !Object.keys(d.sessions).length;
  };
  Store.prototype.list = function (c) {
    var src = this.data[c], out = [];
    Object.keys(src).forEach(function (id) { var r = src[id]; if (!r.deleted) { var o = JSON.parse(JSON.stringify(r)); o.id = id; out.push(o); } });
    return out;
  };
  Store.prototype.get = function (c, id) { var r = this.data[c][id]; return r && !r.deleted ? r : null; };
  Store.prototype.put = function (c, id, rec) {
    var r = JSON.parse(JSON.stringify(rec)); delete r.id; r.updatedAt = Date.now();
    this.data[c][id] = r; this.saveLocal(); this.scheduleSync();
  };
  Store.prototype.remove = function (c, id) {
    this.data[c][id] = { deleted: true, updatedAt: Date.now() }; this.saveLocal(); this.scheduleSync();
  };
  Store.prototype.replaceAll = function (d) { this.data = merge(this.data, d); this.saveLocal(); this.onChange(); this.scheduleSync(); };
  Store.prototype.saveLocal = function () {
    if (!writeJSON(LOCAL_KEY, this.data)) this.status("error", "Couldn't save on this phone. Storage may be full.");
  };
  Store.prototype.saveMeta = function () { writeJSON(META_KEY, this.meta); };
  Store.prototype.status = function (state, detail) { this.state = state; this.detail = detail || ""; this.onStatus(state, this.detail); };

  Store.prototype.scheduleSync = function () {
    var self = this;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.sync(false); }, 3000);
    if (this.state === "synced") this.status("pending", "");
  };

  // ---- Google sign-in ----
  Store.prototype.driveReady = function () { return !!this.clientId; };
  Store.prototype.hasToken = function () { return !!this.token && this.tokenExp > Date.now() + 60000; };
  Store.prototype.getToken = function (interactive) {
    var self = this;
    if (this.hasToken()) return Promise.resolve(this.token);
    if (!interactive) return Promise.resolve(null);
    if (!root.google || !root.google.accounts || !root.google.accounts.oauth2) return Promise.reject(new Error("Google sign-in hasn't loaded yet. Check your signal and try again."));
    return new Promise(function (resolve, reject) {
      var client = root.google.accounts.oauth2.initTokenClient({
        client_id: self.clientId, scope: SCOPE,
        callback: function (resp) {
          if (resp && resp.access_token) {
            self.token = resp.access_token; self.tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
            self.meta.token = self.token; self.meta.tokenExp = self.tokenExp; self.meta.hadConsent = true; self.saveMeta();
            resolve(self.token);
          } else reject(new Error((resp && resp.error) || "Sign-in was cancelled."));
        },
        error_callback: function (err) { reject(new Error((err && err.type === "popup_closed") ? "Sign-in was closed before it finished." : "Couldn't open Google sign-in.")); }
      });
      client.requestAccessToken({ prompt: self.meta.hadConsent ? "" : "consent" });
    });
  };
  Store.prototype.dropToken = function () { this.token = null; this.tokenExp = 0; delete this.meta.token; delete this.meta.tokenExp; this.saveMeta(); };

  // ---- Drive calls ----
  Store.prototype.api = function (url, init) {
    var self = this; init = init || {}; init.headers = init.headers || {};
    init.headers.Authorization = "Bearer " + this.token;
    return root.fetch(url, init).then(function (res) {
      if (res.status === 401) { self.dropToken(); var e = new Error("auth"); e.auth = true; throw e; }
      if (res.status === 404) { var n = new Error("notfound"); n.notFound = true; throw n; }
      if (!res.ok) throw new Error("Drive answered " + res.status);
      return res;
    });
  };
  Store.prototype.findFile = function () {
    var q = encodeURIComponent("name = '" + FILE_NAME + "' and trashed = false");
    return this.api("https://www.googleapis.com/drive/v3/files?q=" + q + "&orderBy=modifiedTime%20desc&fields=files(id,modifiedTime)&spaces=drive")
      .then(function (r) { return r.json(); }).then(function (j) { return (j.files && j.files[0]) ? j.files[0].id : null; });
  };
  Store.prototype.download = function (id) {
    return this.api("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media").then(function (r) { return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error("The Drive file isn't valid JSON, so it wasn't changed. Fix or delete \"" + FILE_NAME + "\" in Drive."); } });
  };
  Store.prototype.create = function (data) {
    var b = "gymlog" + Math.random().toString(36).slice(2);
    var body = "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name: FILE_NAME, mimeType: "application/json" }) +
      "\r\n--" + b + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify(data, null, 1) + "\r\n--" + b + "--";
    return this.api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body: body
    }).then(function (r) { return r.json(); }).then(function (j) { return j.id; });
  };
  Store.prototype.upload = function (id, data) {
    return this.api("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data, null, 1)
    });
  };

  // ---- Sync: pull Drive copy, merge, push the merged result back ----
  Store.prototype.sync = function (interactive) {
    var self = this;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.clientId) { this.status("local", "Saved on this phone. Drive sync isn't set up yet."); return Promise.resolve(); }
    if (this.syncing) { this.again = true; return Promise.resolve(); }
    if (root.navigator && root.navigator.onLine === false) { this.status("offline", "Offline. Saved on this phone; it will sync when you're back online."); return Promise.resolve(); }
    this.syncing = true;
    return this.getToken(interactive).then(function (tok) {
      if (!tok) { self.status("signin", "Tap Sync to sign in to Google Drive."); return; }
      self.status("syncing", "");
      var fileId = self.meta.fileId;
      var findP = fileId ? Promise.resolve(fileId) : self.findFile();
      return findP.then(function (id) {
        fileId = id;
        return id ? self.download(id).catch(function (e) { if (e.notFound) { fileId = null; return null; } throw e; }) : null;
      }).then(function (remote) {
        var merged = remote ? merge(self.data, remote) : normalise(self.data);
        var localChanged = !same(merged, self.data);
        self.data = merged; self.saveLocal();
        if (localChanged) self.onChange();
        if (!fileId) return self.create(merged).then(function (id) { self.meta.fileId = id; self.saveMeta(); });
        self.meta.fileId = fileId; self.saveMeta();
        if (!remote || !same(merged, normalise(remote))) return self.upload(fileId, merged);
      }).then(function () {
        self.meta.lastSync = Date.now(); self.saveMeta();
        self.status("synced", "");
      });
    }).catch(function (e) {
      if (e && e.auth) self.status("signin", "Your Google sign-in expired. Tap Sync to sign in again.");
      else self.status("error", (e && e.message && e.message !== "Failed to fetch") ? e.message : "Couldn't reach Google Drive. Your changes are saved on this phone.");
    }).then(function () {
      self.syncing = false;
      if (self.again) { self.again = false; self.sync(false); }
    });
  };

  var api = { Store: Store, merge: merge, normalise: normalise, same: same, FILE_NAME: FILE_NAME };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.GymStore = api;
})(typeof window !== "undefined" ? window : globalThis);
