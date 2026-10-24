const { app } = require("electron");

// In-app updates flow through electron-updater against GitHub Releases. On
// Linux only the AppImage transport supports self-update; deb/rpm installs
// are detected and reported as unsupported so the UI can point users at their
// package manager instead.
// 应用内更新经 electron-updater 对接 GitHub Releases。Linux 上仅 AppImage
// 支持自更新；检测到 deb/rpm 安装时上报不支持，让 UI 引导用户使用包管理器。
let autoUpdater = null;
let statusListener = null;
let lastStatus = { status: "idle" };

function isAppImageInstall() {
  return Boolean(process.env.APPIMAGE && process.env.APPIMAGE.length > 0);
}

function isUpdateSupported() {
  if (!app.isPackaged) {
    return false;
  }

  if (process.platform === "linux") {
    return isAppImageInstall();
  }

  return true;
}

function emitStatus(partial) {
  lastStatus = { ...lastStatus, ...partial };
  if (statusListener) {
    try {
      statusListener({ ...lastStatus });
    } catch (_error) {
      // Status pushes are best-effort UI hints.
      // 状态推送只是尽力而为的 UI 提示。
    }
  }
}

function ensureAutoUpdater() {
  if (autoUpdater) {
    return autoUpdater;
  }

  const { autoUpdater: updater } = require("electron-updater");
  autoUpdater = updater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    emitStatus({ status: "checking", progress: null, message: null });
  });

  autoUpdater.on("update-available", (info) => {
    emitStatus({ status: "available", version: info?.version ?? null, progress: null });
  });

  autoUpdater.on("update-not-available", () => {
    emitStatus({ status: "not-available", progress: null, message: null });
  });

  autoUpdater.on("download-progress", (progress) => {
    emitStatus({
      status: "downloading",
      progress: {
        percent: Math.round(progress?.percent ?? 0),
        transferred: Math.round(progress?.transferred ?? 0),
        total: Math.round(progress?.total ?? 0),
      },
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    emitStatus({ status: "downloaded", version: info?.version ?? null, progress: null });
  });

  autoUpdater.on("error", (error) => {
    emitStatus({ status: "error", message: error?.message ?? String(error), progress: null });
  });

  return autoUpdater;
}

function setUpdatesListener(listener) {
  statusListener = typeof listener === "function" ? listener : null;
  return { ...lastStatus };
}

function getUpdateStatus() {
  return { ...lastStatus };
}

async function checkForUpdates() {
  if (!isUpdateSupported()) {
    emitStatus({ status: "unsupported" });
    return getUpdateStatus();
  }

  const updater = ensureAutoUpdater();
  const result = await updater.checkForUpdates();
  return getUpdateStatus();
}

async function downloadUpdate() {
  if (!isUpdateSupported()) {
    emitStatus({ status: "unsupported" });
    return getUpdateStatus();
  }

  const updater = ensureAutoUpdater();
  await updater.downloadUpdate();
  return getUpdateStatus();
}

function installUpdate() {
  if (!isUpdateSupported()) {
    return false;
  }

  const updater = ensureAutoUpdater();
  // quitAndInstall relaunches the app after swapping the AppImage; the tray
  // and managed shutdown hooks run through the normal before-quit path.
  // quitAndInstall 会在替换 AppImage 后重启应用；托盘与托管服务关闭
  // 都走正常的 before-quit 流程。
  updater.quitAndInstall();
  return true;
}

module.exports = {
  isUpdateSupported,
  setUpdatesListener,
  getUpdateStatus,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
};
