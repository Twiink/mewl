const fs = require("node:fs/promises");
const path = require("node:path");
const { getSettings, getConfigRootPath } = require("./settings.cjs");

const logsDirName = "logs";
const flushDelayMs = 1000;
const cleanupIntervalMs = 24 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

const logsDirectory = path.join(getConfigRootPath(), "mewl", logsDirName);

const pendingWrites = new Map();
let flushTimer = null;
let cleanupTimer = null;
let writeChain = Promise.resolve();

function formatDayStamp(timestamp) {
  // Local-time day buckets: users read "today's log" by their own clock, so
  // files must roll over at local midnight, not UTC midnight.
  // 按本地时间分日：用户按自己的时钟理解“今天的日志”，因此文件应在
  // 本地午夜滚动，而非 UTC 午夜。
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

function sanitizeFileToken(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
}

// Map each unified log category to its on-disk file. Managed output is split
// per service and per stream; internal, automation, and alert events share the
// Mewl diagnostic file; container and system sources get their own streams.
// 将统一日志的每个类别映射到磁盘文件。托管输出按服务和流拆分；
// 内部、自动化与告警事件共享 Mewl 诊断文件；容器与系统来源各有独立流。
function resolveFileNameForEvent(event) {
  const dayStamp = formatDayStamp(event.timestamp || Date.now());

  if (event.category === "managed-stdout" || event.category === "managed-stderr") {
    const stream = event.stream === "stderr" ? "stderr" : "stdout";
    return `${sanitizeFileToken(event.serviceId || event.source)}_${dayStamp}_${stream}.log`;
  }

  if (event.category === "container") {
    return `${sanitizeFileToken(event.serviceId || event.source)}_${dayStamp}_docker.log`;
  }

  if (event.category === "system") {
    return `system_${dayStamp}.log`;
  }

  return `mewl_${dayStamp}_internal.log`;
}

function formatEventLine(event) {
  const stamp = event.timestamp || new Date().toISOString();
  const level = String(event.level || "info").toUpperCase();
  const source = event.serviceName || event.sourceLabel || event.source || "mewl";
  return `${stamp} [${level}] [${source}] ${event.message ?? ""}\n`;
}

function queueWrite(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  const fileName = resolveFileNameForEvent(event);
  pendingWrites.set(fileName, (pendingWrites.get(fileName) ?? "") + formatEventLine(event));

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPendingWrites();
    }, flushDelayMs);
  }
}

async function flushPendingWrites() {
  if (pendingWrites.size === 0) {
    return;
  }

  const writes = [...pendingWrites.entries()];
  pendingWrites.clear();
  await fs.mkdir(logsDirectory, { recursive: true });

  // Serialize appends per tick so concurrent flushes never interleave partial
  // lines inside the same file. Each link swallows its own failure: one bad
  // append must not leave the chain rejected, which would silently drop
  // every later write until restart.
  // 每个 tick 内串行追加，避免并发 flush 在同一文件中交错半行。
  // 每个链节自行吞掉失败：单次追加失败不能让链条保持 rejected 状态，
  // 否则重启前的所有后续写入都会被静默丢弃。
  writeChain = writes.reduce(
    (chain, [fileName, content]) =>
      chain
        .then(() => fs.appendFile(path.join(logsDirectory, fileName), content, "utf8"))
        .catch((_error) => {
          // Per-file failures are isolated; the next flush retries fresh data.
          // 单文件失败被隔离；下一次 flush 会重试新数据。
        }),
    writeChain,
  );

  await writeChain;
}

async function cleanupOldLogFiles() {
  const { logRetentionDays } = getSettings();
  const cutoff = Date.now() - logRetentionDays * dayMs;

  let entries = [];
  try {
    entries = await fs.readdir(logsDirectory);
  } catch (_error) {
    return;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".log")) {
      continue;
    }

    const filePath = path.join(logsDirectory, entry);
    try {
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs < cutoff) {
        await fs.unlink(filePath);
      }
    } catch (_error) {
      // Skip unreadable/stale entries during the retention sweep.
      // 保留期清理时跳过不可读或已消失的条目。
    }
  }
}

async function initLogFilePersistence() {
  await fs.mkdir(logsDirectory, { recursive: true });
  await cleanupOldLogFiles();

  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      void cleanupOldLogFiles();
    }, cleanupIntervalMs);
  }
}

async function stopLogFilePersistence() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  await flushPendingWrites();
}

function getLogsDirectory() {
  return logsDirectory;
}

module.exports = {
  initLogFilePersistence,
  stopLogFilePersistence,
  queueWrite,
  flushPendingWrites,
  cleanupOldLogFiles,
  getLogsDirectory,
};
