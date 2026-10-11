const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clicker", {
  setTargets: (targets) => ipcRenderer.send("set-targets", targets),
  start: () => ipcRenderer.invoke("start"),
  stop: () => ipcRenderer.invoke("stop"),
  setHotkeys: (h) => ipcRenderer.invoke("set-hotkeys", h),
  getPosition: () => ipcRenderer.invoke("get-position"),

  onCaptured: (cb) => ipcRenderer.on("captured", (_e, p) => cb(p)),
  onState: (cb) => ipcRenderer.on("state", (_e, on) => cb(on)),
  onMessage: (cb) => ipcRenderer.on("message", (_e, m) => cb(m))
});
