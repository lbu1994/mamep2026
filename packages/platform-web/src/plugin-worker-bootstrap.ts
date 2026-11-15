/**
 * 插件隔离 Worker 引导脚本。
 *
 * 主线程把该源码作为 Blob 创建 Web Worker；Worker 内动态 import 单文件 JS 插件
 * （entrySource，须自包含无外部 import），提取 manifest / activate / deactivate，
 * 经 postMessage 协议与主线程隔离桥通信：
 *
 * - 主 → Worker：`init{entrySource}` / `activate{pluginId}` / `deactivate` /
 *   `communication-response{id,result}`
 * - Worker → 主：`ready{manifest}` / `load-error{message}` / `activated` /
 *   `deactivated` / `error{message}` / `communication-request{id,op,payload}`
 *
 * 插件唯一外部通道为 communication（readRegisters/writeRegisters 经消息往返
 * 主线程统一调度器）；Worker 全局无 DOM / 无 Node API，天然能力受限（白名单）。
 */
export const PLUGIN_WORKER_BOOTSTRAP = `
self.onmessage = function (event) {
  var msg = event.data;
  if (!msg || typeof msg.type !== "string") return;
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
    self.postMessage({ type: "communication-request", id: id, op: op, payload: payload });
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
      return import(url);
    })
    .then(function (mod) {
      if (!mod || typeof mod !== "object" || !mod.manifest) {
        throw new Error("plugin entry must export a manifest");
      }
      manifestValue = mod.manifest;
      activateFn = typeof mod.activate === "function" ? mod.activate : null;
      deactivateFn = typeof mod.deactivate === "function" ? mod.deactivate : null;
      self.postMessage({ type: "ready", manifest: manifestValue });
    })
    .catch(function (err) {
      self.postMessage({ type: "load-error", message: String((err && err.message) || err) });
    });
}

function runActivate(pluginId) {
  return Promise.resolve()
    .then(function () {
      if (!activateFn) throw new Error("plugin entry has no activate export");
      return activateFn({ pluginId: pluginId, communication: communicationApi(pluginId) });
    })
    .then(function () { self.postMessage({ type: "activated" }); })
    .catch(function (err) {
      self.postMessage({ type: "error", message: String((err && err.message) || err) });
    });
}

function runDeactivate() {
  return Promise.resolve()
    .then(function () { if (deactivateFn) return deactivateFn(); })
    .catch(function () { /* deactivate 失败不阻断关闭 */ })
    .then(function () { self.postMessage({ type: "deactivated" }); });
}
`;
