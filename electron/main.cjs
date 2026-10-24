const path = require("node:path");
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require("electron");
const {
  hydrateRuntimeSnapshot,
  performProcessAction,
  shutdownManagedServices,
  setRuntimeLogBatchListener,
  setRuntimeLocale,
  onRuntimeLocaleChanged,
  rt,
  updateManagedService,
  createManagedService,
  removeManagedService,
  applyAutomationRule,
} = require("./runtime.cjs");
const {
  loadSettings,
  getSettings,
  updateSettings,
  onSettingsChanged,
} = require("./settings.cjs");
const {
  createTerminalSession,
  writeTerminalInput,
  resizeTerminalSession,
  killTerminalSession,
  killAllTerminalSessions,
  listTerminalSessions,
  setTerminalListener,
} = require("./terminal.cjs");
const {
  isUpdateSupported,
  setUpdatesListener,
  getUpdateStatus,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
} = require("./updates.cjs");
const { getLogsDirectory } = require("./log-files.cjs");

const devServerUrl = process.env.MEWL_RENDERER_URL;

let mainWindow = null;
let tray = null;
let suppressCloseToTray = false;
let updateAutoCheckTimer = null;

function resolveTrayIconPath() {
  // Linux tray icons must come from the filesystem (nativeImage paths from
  // asar work); the 32px png matches the standard panel icon size while
  // keeping enough detail for scaled environments.
  // Linux 托盘图标必须来自文件系统路径；32px png 匹配标准面板图标尺寸，
  // 同时在缩放环境下保留足够细节。
  return path.join(__dirname, "..", "build", "icons", "png", "32x32.png");
}

function createTray() {
  if (tray || process.platform === "win32") {
    return;
  }

  const icon = nativeImage.createFromPath(resolveTrayIconPath());
  tray = new Tray(icon);
  rebuildTrayMenu();

  tray.on("double-click", () => {
    showMainWindow();
  });
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: rt("tray.show"),
      click: () => {
        showMainWindow();
      },
    },
    { type: "separator" },
    {
      label: rt("tray.quit"),
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(rt("tray.tooltip"));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#07090d",
    title: "Mewl",
    autoHideMenuBar: true,
    show: getSettings().showWindowOnStartup,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("Mewl renderer failed to load", {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Mewl renderer process exited unexpectedly", details);
  });

  window.on("close", (event) => {
    // With close-to-tray enabled the window hides instead of closing; only a
    // quit through the tray menu or updater proceeds to the real close.
    // 开启「关闭到托盘」时窗口隐藏而非关闭；只有托盘菜单退出或更新器
    // 触发的退出才进入真正的关闭流程。
    if (!app.isQuitting && getSettings().closeToTray && tray) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on("closed", () => {
    mainWindow = null;
    if (!app.isQuitting && !tray) {
      app.quit();
    }
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    return window;
  }

  void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  return window;
}

function broadcastToWindows(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

async function bootstrap() {
  ipcMain.handle("mewl:hydrate-runtime", async (_event, payload) =>
    hydrateRuntimeSnapshot(payload && typeof payload === "object" ? payload : {}),
  );
  ipcMain.handle("mewl:set-locale", async (_event, payload) => {
    setRuntimeLocale(payload?.locale);
  });
  ipcMain.handle("mewl:process-action", async (_event, payload) =>
    performProcessAction(payload.action, payload.processId),
  );
  ipcMain.handle("mewl:update-managed-service", async (_event, payload) =>
    updateManagedService(payload.processId, payload.updates),
  );
  ipcMain.handle("mewl:create-managed-service", async (_event, payload) =>
    createManagedService(payload.service),
  );
  ipcMain.handle("mewl:remove-managed-service", async (_event, payload) =>
    removeManagedService(payload.processId),
  );
  ipcMain.handle("mewl:apply-automation-rule", async (_event, payload) =>
    applyAutomationRule(payload.ruleId, payload.enabled),
  );

  ipcMain.handle("mewl:get-settings", async () => getSettings());
  ipcMain.handle("mewl:update-settings", async (_event, payload) => updateSettings(payload));
  ipcMain.handle("mewl:open-logs-directory", async () => {
    await shell.openPath(getLogsDirectory());
    return true;
  });

  ipcMain.handle("mewl:terminal-create", async (_event, payload) =>
    createTerminalSession(payload),
  );
  ipcMain.handle("mewl:terminal-kill", async (_event, payload) =>
    killTerminalSession(payload?.sessionId),
  );
  ipcMain.handle("mewl:terminal-list", async () => listTerminalSessions());
  ipcMain.on("mewl:terminal-input", (_event, payload) => {
    writeTerminalInput(payload?.sessionId, payload?.data);
  });
  ipcMain.on("mewl:terminal-resize", (_event, payload) => {
    resizeTerminalSession(payload?.sessionId, payload?.cols, payload?.rows);
  });

  ipcMain.handle("mewl:get-update-status", async () => ({
    ...getUpdateStatus(),
    supported: isUpdateSupported(),
  }));
  ipcMain.handle("mewl:check-updates", async () => ({
    ...(await checkForUpdates()),
    supported: isUpdateSupported(),
  }));
  ipcMain.handle("mewl:download-update", async () => downloadUpdate());
  ipcMain.handle("mewl:install-update", async () => installUpdate());

  await app.whenReady();
  await loadSettings();

  setRuntimeLogBatchListener((events) => {
    broadcastToWindows("mewl:logs-batch", events);
  });

  setTerminalListener((payload) => {
    broadcastToWindows(payload.type === "exit" ? "mewl:terminal-exit" : "mewl:terminal-data", payload);
  });

  setUpdatesListener((status) => {
    broadcastToWindows("mewl:update-status", status);
  });

  onSettingsChanged((settings) => {
    if (!settings.closeToTray) {
      return;
    }

    // Tray-dependent settings only apply while the tray exists; creating it
    // lazily here covers the first run where defaults enable close-to-tray.
    // 依赖托盘的设置只在托盘存在时生效；这里惰性创建托盘，
    // 覆盖默认开启 close-to-tray 的首次运行。
    createTray();
  });

  onRuntimeLocaleChanged(() => {
    rebuildTrayMenu();
  });

  createTray();

  if (getSettings().showWindowOnStartup || BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }

  app.on("activate", () => {
    showMainWindow();
  });

  if (getSettings().autoCheckUpdates && isUpdateSupported()) {
    updateAutoCheckTimer = setTimeout(() => {
      void checkForUpdates().catch(() => {
        // A failed background update check stays silent until the user asks.
        // 后台更新检查失败时保持静默，等待用户主动查询。
      });
    }, 15 * 1000);
  }
}

app.setName("Mewl");

void bootstrap();

app.on("window-all-closed", () => {
  // With a tray present the app keeps running after the last window hides;
  // without one, closing the window means quitting (except on macOS).
  // 有托盘时最后一个窗口隐藏后应用继续驻留；没有托盘时关窗即退出
  //（macOS 除外）。
  if (!tray && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  app.isQuitting = true;

  if (updateAutoCheckTimer) {
    clearTimeout(updateAutoCheckTimer);
    updateAutoCheckTimer = null;
  }

  killAllTerminalSessions();
  await shutdownManagedServices();
});
