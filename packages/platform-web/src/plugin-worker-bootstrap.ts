/**
 * Worker bootstrap for the versioned plugin message bridge.
 * The host creates this Worker inside an opaque-origin iframe with a restrictive CSP.
 */
export const PLUGIN_WORKER_BOOTSTRAP = `
self.onmessage = function (event) {
  var msg = event.data;
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "ping") { self.postMessage({ version: 1, type: "pong", id: msg.id }); return; }
  if (msg.type === "init") {
    void init(msg.entrySource);
    return;
  }
  if (msg.type === "activate") {
    void runActivate(msg.pluginId);
    return;
  }
  if (msg.type === "deactivate") {
    void runDeactivate();
    return;
  }
  if (msg.type === "communication-response") {
    var pending = pendingMap[msg.id];
    if (pending) {
      delete pendingMap[msg.id];
      pending(msg.result);
    }
    return;
  }
};

var manifestValue = null;
var activateFn = null;
var deactivateFn = null;
var nextId = 1;
var pendingMap = Object.create(null);

function callMain(op, payload) {
  return new Promise(function (resolve) {
    var id = nextId++;
    pendingMap[id] = resolve;
    self.postMessage({ version: 1, type: "communication-request", id: id, op: op, payload: payload });
  });
}

function communicationApi(pluginId) {
  return {
    readRegisters: function (req) { return callMain("read", { pluginId: pluginId, req: req }); },
    writeRegisters: function (req) { return callMain("write", { pluginId: pluginId, req: req }); }
  };
}

function init(entrySource) {
  return Promise.resolve()
    .then(function () {
      var url = URL.createObjectURL(new Blob([entrySource], { type: "text/javascript" }));
      return import(url).finally(function () { URL.revokeObjectURL(url); });
    })
    .then(function (mod) {
      if (!mod || typeof mod !== "object" || !mod.manifest) {
        throw new Error("plugin entry must export a manifest");
      }
      manifestValue = mod.manifest;
      activateFn = typeof mod.activate === "function" ? mod.activate : null;
      deactivateFn = typeof mod.deactivate === "function" ? mod.deactivate : null;
      self.postMessage({ version: 1, type: "ready", manifest: manifestValue });
    })
    .catch(function (err) {
      self.postMessage({ version: 1, type: "load-error", message: String((err && err.message) || err) });
    });
}

function runActivate(pluginId) {
  return Promise.resolve()
    .then(function () {
      if (!activateFn) throw new Error("plugin entry has no activate export");
      return activateFn({ pluginId: pluginId, communication: communicationApi(pluginId) });
    })
    .then(function () { self.postMessage({ version: 1, type: "activated" }); })
    .catch(function (err) {
      self.postMessage({ version: 1, type: "error", message: String((err && err.message) || err) });
    });
}

function runDeactivate() {
  return Promise.resolve()
    .then(function () { if (deactivateFn) return deactivateFn(); })
    .then(function () { self.postMessage({ version: 1, type: "deactivated" }); })
    .catch(function (err) { self.postMessage({ version: 1, type: "error", message: String((err && err.message) || err) }); });
}
`;
