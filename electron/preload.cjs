const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mewlHost", {
  hydrateRuntimeSnapshot: (options) => ipcRenderer.invoke("mewl:hydrate-runtime", options ?? {}),
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

  getSettings: () => ipcRenderer.invoke("mewl:get-settings"),
  updateSettings: (updates) => ipcRenderer.invoke("mewl:update-settings", updates),
  openLogsDirectory: () => ipcRenderer.invoke("mewl:open-logs-directory"),

  createTerminalSession: (options) => ipcRenderer.invoke("mewl:terminal-create", options),
  killTerminalSession: (sessionId) => ipcRenderer.invoke("mewl:terminal-kill", { sessionId }),
  listTerminalSessions: () => ipcRenderer.invoke("mewl:terminal-list"),
  writeTerminal: (sessionId, data) =>
    ipcRenderer.send("mewl:terminal-input", { sessionId, data }),
  resizeTerminal: (sessionId, cols, rows) =>
    ipcRenderer.send("mewl:terminal-resize", { sessionId, cols, rows }),
  subscribeToTerminal: (handlers) => {
    const dataHandler = (_event, payload) => handlers.onData?.(payload);
    const exitHandler = (_event, payload) => handlers.onExit?.(payload);

    ipcRenderer.on("mewl:terminal-data", dataHandler);
    ipcRenderer.on("mewl:terminal-exit", exitHandler);
    return () => {
      ipcRenderer.removeListener("mewl:terminal-data", dataHandler);
      ipcRenderer.removeListener("mewl:terminal-exit", exitHandler);
    };
  },

  getUpdateStatus: () => ipcRenderer.invoke("mewl:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("mewl:check-updates"),
  downloadUpdate: () => ipcRenderer.invoke("mewl:download-update"),
  installUpdate: () => ipcRenderer.invoke("mewl:install-update"),
  subscribeToUpdateStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("mewl:update-status", handler);
    return () => {
      ipcRenderer.removeListener("mewl:update-status", handler);
    };
  },
});
