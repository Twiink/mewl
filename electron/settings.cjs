const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");

const settingsFileName = "mewl.settings.json";

const defaultSettings = {
  showWindowOnStartup: true,
  closeToTray: true,
  logRetentionDays: 7,
  historyRetentionDays: 7,
  autoCheckUpdates: true,
};

// Mirrors the config-root resolution in runtime.cjs so every Mewl file lives
// under the same per-user application data location.
// 与 runtime.cjs 的配置根目录解析保持一致，让所有 Mewl 数据文件
// 落在同一个每用户应用数据位置。
function getConfigRootPath() {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

const settingsConfigDir = path.join(getConfigRootPath(), "mewl");
const settingsFilePath = path.join(settingsConfigDir, settingsFileName);

const settingsListeners = new Set();
let cachedSettings = null;

function coerceRetentionDays(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(365, Math.max(1, Math.round(value)));
}

function coerceSettings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    showWindowOnStartup:
      typeof source.showWindowOnStartup === "boolean"
        ? source.showWindowOnStartup
        : defaultSettings.showWindowOnStartup,
    closeToTray:
      typeof source.closeToTray === "boolean"
        ? source.closeToTray
        : defaultSettings.closeToTray,
    logRetentionDays: coerceRetentionDays(
      Number(source.logRetentionDays),
      defaultSettings.logRetentionDays,
    ),
    historyRetentionDays: coerceRetentionDays(
      Number(source.historyRetentionDays),
      defaultSettings.historyRetentionDays,
    ),
    autoCheckUpdates:
      typeof source.autoCheckUpdates === "boolean"
        ? source.autoCheckUpdates
        : defaultSettings.autoCheckUpdates,
  };
}

async function ensureSettingsFile() {
  await fs.mkdir(settingsConfigDir, { recursive: true });
}

async function loadSettings() {
  await ensureSettingsFile();

  try {
    const raw = await fs.readFile(settingsFilePath, "utf8");
    cachedSettings = coerceSettings(JSON.parse(raw));
  } catch (_error) {
    cachedSettings = { ...defaultSettings };
    await fs.writeFile(
      settingsFilePath,
      `${JSON.stringify(cachedSettings, null, 2)}\n`,
      "utf8",
    );
  }

  return getSettings();
}

function getSettings() {
  // Callers in the main process may read before the first async load lands;
  // fall back to defaults so window creation and retention sweeps always
  // have a usable value.
  // 主进程调用方可能在首次异步加载完成前读取；回退到默认值，
  // 保证窗口创建与保留期清理始终有可用配置。
  return cachedSettings ? { ...cachedSettings } : { ...defaultSettings };
}

async function updateSettings(partial) {
  const next = coerceSettings({
    ...getSettings(),
    ...(partial && typeof partial === "object" && !Array.isArray(partial) ? partial : {}),
  });

  cachedSettings = next;
  await ensureSettingsFile();
  await fs.writeFile(settingsFilePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  for (const listener of settingsListeners) {
    try {
      listener({ ...next });
    } catch (_error) {
      // Listener failures must never block a settings write.
      // 监听器异常不能阻塞设置写入。
    }
  }

  return { ...next };
}

function onSettingsChanged(listener) {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

function getSettingsFilePath() {
  return settingsFilePath;
}

module.exports = {
  loadSettings,
  getSettings,
  updateSettings,
  onSettingsChanged,
  getSettingsFilePath,
  getConfigRootPath,
};
