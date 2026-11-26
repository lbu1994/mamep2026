/**
 * Node worker bootstrap for the versioned plugin message bridge.
 * Thread separation does not remove Node system privileges.
 */
export const PLUGIN_NODE_WORKER_BOOTSTRAP = `
const { parentPort } = require("node:worker_threads");

var port = parentPort;
var manifestValue = null;
var activateFn = null;
var deactivateFn = null;
var nextId = 1;
var pendingMap = Object.create(null);

function callMain(op, payload) {
  return new Promise(function (resolve) {
    var id = nextId++;
    pendingMap[id] = resolve;
    port.postMessage({ version: 1, type: "communication-request", id: id, op: op, payload: payload });
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
      var url = "data:text/javascript;base64," + Buffer.from(entrySource, "utf8").toString("base64");
      return import(url);
    })
    .then(function (mod) {
      if (!mod || typeof mod !== "object" || !mod.manifest) {
        throw new Error("plugin entry must export a manifest");
      }
      manifestValue = mod.manifest;
      activateFn = typeof mod.activate === "function" ? mod.activate : null;
      deactivateFn = typeof mod.deactivate === "function" ? mod.deactivate : null;
      port.postMessage({ version: 1, type: "ready", manifest: manifestValue });
    })
    .catch(function (err) {
      port.postMessage({ version: 1, type: "load-error", message: String((err && err.message) || err) });
    });
}

function runActivate(pluginId) {
  return Promise.resolve()
    .then(function () {
      if (!activateFn) throw new Error("plugin entry has no activate export");
      return activateFn({ pluginId: pluginId, communication: communicationApi(pluginId) });
    })
    .then(function () { port.postMessage({ version: 1, type: "activated" }); })
    .catch(function (err) {
      port.postMessage({ version: 1, type: "error", message: String((err && err.message) || err) });
    });
}

function runDeactivate() {
  return Promise.resolve()
    .then(function () { if (deactivateFn) return deactivateFn(); })
    .catch(function () { })
    .then(function () { port.postMessage({ version: 1, type: "deactivated" }); });
}

port.on("message", function (msg) {
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "init") { void init(msg.entrySource); return; }
  if (msg.type === "activate") { void runActivate(msg.pluginId); return; }
  if (msg.type === "deactivate") { void runDeactivate(); return; }
  if (msg.type === "communication-response") {
    var pending = pendingMap[msg.id];
    if (pending) { delete pendingMap[msg.id]; pending(msg.result); }
    return;
  }
});
`;
