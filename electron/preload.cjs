const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mewlHost", {
  hydrateRuntimeSnapshot: () => ipcRenderer.invoke("mewl:hydrate-runtime"),
  // Forward the renderer's locale so bridge-generated alerts, logs, and action
  // messages are produced in the active language.
  // 转发渲染进程的语言设置，使桥接生成的告警、日志与操作消息跟随当前语言。
  setLocale: (locale) => ipcRenderer.invoke("mewl:set-locale", { locale }),
  subscribeToLogs: (listener) => {
    const handler = (_event, events) => {
      listener(Array.isArray(events) ? events : []);
    };

    ipcRenderer.on("mewl:logs-batch", handler);
    return () => {
      ipcRenderer.removeListener("mewl:logs-batch", handler);
    };
  },
  performProcessAction: (action, processId) =>
    ipcRenderer.invoke("mewl:process-action", { action, processId }),
  updateManagedService: (processId, updates) =>
    ipcRenderer.invoke("mewl:update-managed-service", { processId, updates }),
  createManagedService: (service) => ipcRenderer.invoke("mewl:create-managed-service", { service }),
  removeManagedService: (processId) =>
    ipcRenderer.invoke("mewl:remove-managed-service", { processId }),
  applyAutomationRule: (ruleId, enabled) =>
    ipcRenderer.invoke("mewl:apply-automation-rule", { ruleId, enabled }),
});
