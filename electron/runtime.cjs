const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { createConsola } = require("consola");
const logFileSink = require("./log-files.cjs");
const { getSettings } = require("./settings.cjs");

const execFileAsync = promisify(execFile);
const processLimit = 18;
const sampleDelayMs = 180;
const oneMegabyte = 1024 * 1024;
const managedLogTailLimit = 12;
const automationHistoryLimit = 36;
const defaultRestartLimit = 3;
const metricHistoryLimit = 24;
const unifiedLogLimit = 1200;
const unifiedLogFlushDelayMs = 140;
// Background history sampling runs in the main process so trends survive
// across renderer refreshes and app restarts. Samples persist to disk and are
// pruned by the historyRetentionDays setting.
// 历史采样在主进程后台运行，使趋势数据跨渲染层刷新与应用重启存续。
// 样本会落盘，并按 historyRetentionDays 设置清理。
const metricSampleIntervalMs = 30 * 1000;
const metricHistoryFlushIntervalMs = 5 * 60 * 1000;
const metricHistoryWindowMs = 7 * 24 * 60 * 60 * 1000;
const monitorWindowRanges = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};
const monitorWindowPointLimit = 240;
const portWatchIntervalMs = 10 * 1000;
const portHistoryEventLimit = 5000;
const portHistoryPerPortLimit = 10;
const repoRoot = process.cwd();
const managedServiceState = new Map();
const metricHistoryState = new Map();
let autoStartInitialized = false;
let historyTimersInitialized = false;
let metricSampleTimer = null;
let metricFlushTimer = null;
let portWatchTimer = null;
let metricHistoryDirty = false;
let portHistoryDirty = false;
let previousPortBindingKeys = null;
const persistentMetricHistory = { samples: [] };
const portHistoryEvents = [];
const defaultInheritedEnvKeys = ["PATH", "HOME", "LANG", "TERM", "USER", "LOGNAME", "SHELL"];
const serviceConfigFileName = "mewl.services.json";
const emptyManagedConfig = {
  services: [],
  profiles: [],
  history: [],
};
const managedServiceKinds = new Set(["command", "script", "docker"]);
const scriptInterpreterByExtension = {
  ".sh": "sh",
  ".bash": "bash",
  ".zsh": "zsh",
  ".command": "sh",
  ".py": "python3",
  ".js": "node",
  ".cjs": "node",
  ".mjs": "node",
};

// ---------------------------------------------------------------------------
// Runtime i18n. The main process generates user-visible alerts, log entries,
// action messages, metric labels, and error text. The renderer pushes the
// active locale through the "mewl:set-locale" IPC channel, and every message
// site below resolves its copy through rt() so the desktop experience follows
// the same language as the UI chrome.
//
// 主进程国际化。主进程会生成用户可见的告警、日志条目、操作消息、指标标签与
// 错误文本。渲染进程通过 "mewl:set-locale" IPC 通道推送当前语言，
// 下方的消息生成点全部经由 rt() 解析文案，使桌面端体验与界面语言保持一致。
//
// Interpolation conventions (shared with src/i18n dictionaries):
//   {name}          -> replaced by params.name
//   {|s}            -> "" when params.count === 1, otherwise "s"
//   {|is,are}       -> "is" when params.count === 1, otherwise "are"
//   {failures|s}    -> plural marker keyed to params.failures instead of count
// 插值约定（与 src/i18n 词典共用）：
//   {name}          -> 替换为 params.name
//   {|s}            -> params.count === 1 时输出 ""，否则输出 "s"
//   {|is,are}       -> params.count === 1 时输出 "is"，否则输出 "are"
//   {failures|s}    -> 以 params.failures 为计数的复数标记（而非 count）
// ---------------------------------------------------------------------------

const runtimeDictionaries = {
  en: {
    "action.stop": "Stop",
    "action.restart": "Restart",

    "uptime.unknown": "unknown",
    "uptime.stopped": "stopped",
    "heartbeat.live": "live",
    "heartbeat.idle": "idle",
    "heartbeat.justNow": "just now",
    "heartbeat.booting": "booting",

    "group.workspace": "workspace",
    "group.browser": "browser",
    "group.development": "development",
    "group.system": "system",
    "group.managed": "managed",

    "lastExit.noRecent": "No recent exit",
    "lastExit.clean": "Clean exit from the Electron bridge",
    "lastExit.signal": "Exited after signal {signal}",
    "lastExit.code": "Exited with code {code}",
    "lastExit.unknownCode": "unknown",
    "lastExit.autoRestartFailed": "Automatic restart failed.",
    "lastExit.runningAfterReattach": "Running after host reattachment",
    "lastExit.stoppedAfterReattach": "Stopped from the Electron bridge after host reattachment",
    "lastExit.autostartFailed": "Autostart failed.",
    "lastExit.profileBootFailed": "Profile boot failed.",

    "log.serviceExited": "Managed service {name} exited ({exit}).",
    "log.serviceStarted": "Managed service {name} started with pid {pid}.",
    "log.serviceStartFailed": "Managed service {name} failed to start: {error}",
    "log.stdoutUpdated": "stdout updated",
    "log.stderrUpdated": "stderr updated",
    "log.stopRequested": "Stop requested for {name}.",
    "log.startRequested": "Start requested for {name}.",
    "log.commandRequested": "{label} command requested for {name}.",
    "log.autoRestartFailed": "Automatic restart failed for {name}.",
    "log.autostartFailed": "Autostart failed for {name}.",

    "internal.journaldStarting": "Starting journald log adapter.",
    "internal.journaldStderr": "journald adapter stderr.",
    "internal.journaldStartFailed": "journald adapter could not start.",
    "internal.journaldStopped": "journald adapter stopped.",
    "internal.skipDockerLogs": "Skipping docker log collection.",
    "internal.reservedPortsOccupied": "Reserved ports are occupied.",
    "internal.hydrating": "Hydrating runtime snapshot.",
    "internal.performingAction": "Performing process action.",
    "internal.onDemandScan": "Running live host scan on demand.",
    "internal.killRequested": "Observed process kill requested.",
    "internal.updatingService": "Updating managed service.",
    "internal.creatingDraft": "Creating managed service draft.",
    "internal.removingService": "Removing managed service.",
    "internal.applyingRule": "Applying automation rule.",
    "log.reattached": "Mewl reattached {name} from a live host process on pid {pid}.",
    "log.terminatedAfterReattach": "Managed host process {name} was terminated after reattachment.",
    "log.discovered": "Discovered {args} from the runtime scan.",
    "log.degradedKernel": "This process is reporting a non-running kernel state.",

    "history.exited": "{name} exited",
    "history.jobCompleted": "{name} completed successfully",
    "history.jobFailed": "{name} failed with exit code {code}",
    "history.jobStopped": "{name} was stopped before finishing",
    "history.exitedUnexpectedly": "{name} exited unexpectedly",
    "history.exitedDetail": "Mewl recorded: {exit}",
    "history.restartLimitReached": "{name} reached restart policy limit",
    "history.restartLimitDetail":
      "Automatic {policy} restarts stopped after {count} attempt{|s} this session.",
    "history.queuedForRestart": "{name} queued for automatic restart",
    "history.queuedDetail":
      "Restart policy {policy} is retrying launch attempt {count} of {limit}.",
    "history.autoRestartFailed": "{name} automatic restart failed",
    "history.autoRestartFailedDetail": "The policy-based restart could not be completed.",
    "history.startFailed": "{name} failed to start",
    "history.autostartFailed": "{name} autostart failed",
    "history.profileStartFailed": "{name} profile start failed",
    "history.started": "Started {name}",
    "history.startedDetailPolicy": "Restart policy requested a new launch.",
    "history.startedDetailProfile": "A startup profile launched this managed service.",
    "history.startedDetailRuntime": "The runtime boot sequence launched this managed service.",
    "history.startedDetailManual": "A managed start action launched this service.",
    "history.stopped": "Stopped {name}",
    "history.stoppedDetailProfile": "A quiet-mode profile ran the configured stop flow.",
    "history.stoppedDetailDocker":
      "Mewl derived a Docker-aware stop flow from the saved launch command.",
    "history.stoppedDetailDefault": "Mewl ran the configured stop flow for this service.",
    "history.stoppedDetailParked": "A quiet-mode profile parked the tracked process.",
    "history.stoppedDetailTracked": "Mewl stopped the tracked process for this managed service.",
    "history.restarted": "Restarted {name}",
    "history.restartedDetailCommand":
      "Mewl ran the configured restart command for this managed service.",
    "history.restartedDetailPolicy": "Restart policy recycled this managed service after an exit.",
    "history.restartedDetailFallback": "Mewl completed the fallback stop/start restart flow.",
    "history.autostartEnabled": "{name} autostart enabled",
    "history.autostartDisabled": "{name} autostart disabled",
    "history.autostartEnabledDetail":
      "This managed service will now launch when the desktop runtime boots.",
    "history.autostartDisabledDetail":
      "This managed service will no longer launch automatically on boot.",
    "history.watchEnabled": "{name} port watch enabled",
    "history.watchDisabled": "{name} port watch disabled",
    "history.watchEnabledDetail": "Mewl will include this service in watched port scans.",
    "history.watchDisabledDetail":
      "Mewl will stop tracking this service during watched port scans.",
    "history.profileEnabled": "{title} enabled",
    "history.profileDisabled": "{title} disabled",
    "history.profileEnabledDetail": "The profile was applied to its managed services.",
    "history.profileDisabledDetail": "The profile was disabled for future automation runs.",

    "alerts.portConflict.title": "Port conflict detected",
    "alerts.portConflict.detail": "{count} live binding{|s} share a reserved port.",
    "alerts.publicExposed.title": "Public listeners exposed",
    "alerts.publicExposed.detail": "{count} binding{|s} are reachable beyond localhost.",
    "alerts.hotProcess.title": "Hot process on the host",
    "alerts.hotProcess.detail": "{name} is currently leading CPU usage at {cpu}%.",
    "alerts.memoryPressure.title": "Memory pressure is elevated",
    "alerts.memoryPressure.detail": "Host memory pressure is currently {value}%.",
    "alerts.gpuLoad.title": "GPU load is elevated",
    "alerts.gpuLoad.detail": "Host GPU load is currently {value}.",
    "alerts.managedParked.title": "Managed service is parked",
    "alerts.managedParked.detail":
      "{name} is registered with Mewl and ready to start from the desktop bridge.",
    "alerts.managedHot.title": "Managed service is running hot",
    "alerts.managedHot.cpuDetail": "{name} is drawing {cpu}% CPU right now.",
    "alerts.managedHot.memoryDetail": "{name} is holding {memory} MB and may need attention.",
    "alerts.crashLoop.title": "Managed service may be crash looping",
    "alerts.crashLoop.detail":
      "{name} logged {failures} recent failure{failures|s} and {retries} policy retr{retries|y,ies} in the last two hours.",
    "alerts.orphanedPort.title": "Reserved port is held by another process",
    "alerts.orphanedPort.detail":
      "{name} expects port {port}, but the live binding currently belongs to a different process.",
    "alerts.healthy.title": "Live host snapshot is healthy",
    "alerts.healthy.detail":
      "No immediate port conflicts or pressure spikes were detected in the latest scan.",

    "metrics.cpu.label": "Host CPU",
    "metrics.cpu.detail": "Live sample from CPU polling.",
    "metrics.memory.label": "Memory Pressure",
    "metrics.memory.detail": "Using {used} MB of {total} MB.",
    "metrics.disk.label": "Disk Activity",
    "metrics.disk.detail": "Root filesystem usage.",
    "metrics.network.label": "Network Chatter",
    "metrics.network.detail": "Observed {throughput} across active interfaces.",
    "metrics.gpu.label": "GPU Load",
    "metrics.gpu.unavailable": "Unavailable",
    "gpu.detail.vram": "{name} using {used} of {total} VRAM.",
    "gpu.detail.utilization": "{name} is reporting a live utilization sample.",
    "gpu.detail.drmBusy": "{card} busy sample from the DRM host telemetry.",
    "gpu.detail.drmVram": "{card} using {used} of {total} VRAM.",
    "gpu.unavailableDetail": "GPU telemetry is unavailable on this host bridge right now.",

    "ports.note.conflict": "Multiple live processes are currently bound to this host port.",
    "ports.note.public": "Listener is reachable beyond the loopback interface.",
    "ports.note.discovered": "Listener was discovered from the live host scan.",

    "processes.description.discoveredCwd": "{runtime} process discovered from {cwd}.",
    "processes.description.discovered": "{runtime} process discovered from the live host scan.",
    "processes.lastExitDiscovered": "Exit history is not available for discovered live processes.",

    "review.legacyCommand":
      "Start command was imported from the older command/args format and should be reviewed in Managed.",
    "review.defaultDescription":
      "Description is still using the default placeholder copy and could use a real service note.",
    "review.cwdFallback":
      "Working directory fell back to `.` from the legacy config and should be confirmed.",
    "review.nameInherited":
      "Service name still looks inherited from the older config key and may deserve a friendlier label.",

    "default.description": "Managed command registered for the Mewl desktop bridge.",
    "default.profileDetail": "Managed startup profile for the Electron runtime bridge.",
    "default.profileCadence": "manual profile",

    "rules.autostartTitle": "{name} autostart",
    "rules.autostartDetail": "Launch {name} automatically when the managed workspace boots.",
    "rules.cadence.sessionStart": "session start",
    "rules.watchTitle": "{name} watch ports",
    "rules.watchDetail": "Include {name} in watched binding scans and collision summaries.",
    "rules.cadence.liveScan": "live scan",

    "errors.executableNotFound": "Managed executable not found: {path}",
    "errors.executableNotOnPath":
      'Managed executable "{command}" is not available on the configured PATH.',
    "errors.scriptNotFound": "Managed script not found: {path}",
    "errors.commandRequired": "Managed services need a command before they can run.",
    "errors.executableTokenRequired":
      "Managed service commands must start with a real executable token.",
    "errors.unmatchedQuote": "Managed command parsing found an unmatched quote.",
    "errors.portsOccupied":
      "{name} could not start because reserved port{|s} {ports} {|is,are} already in use.",
    "errors.alreadyRunning": "Service is already running.",
    "errors.alreadyStopped": "Service is already stopped.",
    "errors.killOnlyObserved": "The observed kill action only supports live observed process rows.",
    "errors.killInvalidPid": "The observed process pid is invalid.",
    "errors.killManagedPid":
      "This pid belongs to a managed service. Use the managed start, stop, or restart controls instead.",
    "errors.processGone": "That observed process is no longer running.",
    "errors.unsupportedAction": "Unsupported action: {action}",
    "errors.serviceNotConfigured":
      "Only configured Mewl-managed services can be controlled from the desktop bridge.",
    "errors.serviceNotEditable":
      "Only configured Mewl-managed services can be edited from the desktop bridge.",
    "errors.nameAndStartRequired": "Managed services need both a name and a start command.",
    "errors.startCommandRequired": "Managed services need a start command before they can be saved.",
    "errors.profileNotFound": "The requested startup profile was not found in mewl.services.json.",
    "errors.ruleNotManaged": "This automation rule is not managed by the Electron bridge.",

    "messages.scanCompleted": "Live host scan completed.",
    "messages.killedObserved": "Terminated observed process {name} (pid {pid}).",
    "messages.started": "Started {name}.",
    "messages.stopped": "Stopped {name}.",
    "messages.restarted": "Restarted {name}.",
    "messages.reviewCleared": "{name} no longer needs legacy cleanup review.",
    "messages.settingsUpdated": "{name} settings updated.",
    "messages.alreadyManaged": "{name} is already managed by Mewl.",
    "messages.nowManaged": "{name} is now managed by Mewl.",
    "messages.alreadyRemoved": "This managed service was already removed.",
    "messages.nowObservedOnly": "{name} is now observed only.",
    "messages.profileEnabled": "{title} enabled.",
    "messages.profileDisabled": "{title} disabled.",

    "tray.show": "Show Mewl",
    "tray.quit": "Quit Mewl",
    "tray.tooltip": "Mewl — local operations dashboard",
  },
  zh: {
    "action.stop": "停止",
    "action.restart": "重启",

    "uptime.unknown": "未知",
    "uptime.stopped": "已停止",
    "heartbeat.live": "实时",
    "heartbeat.idle": "空闲",
    "heartbeat.justNow": "刚刚",
    "heartbeat.booting": "启动中",

    "group.workspace": "工作区",
    "group.browser": "浏览器",
    "group.development": "开发",
    "group.system": "系统",
    "group.managed": "托管",

    "lastExit.noRecent": "暂无退出记录",
    "lastExit.clean": "通过 Electron 桥接正常退出",
    "lastExit.signal": "因信号 {signal} 退出",
    "lastExit.code": "以退出码 {code} 退出",
    "lastExit.unknownCode": "未知",
    "lastExit.autoRestartFailed": "自动重启失败。",
    "lastExit.runningAfterReattach": "主机重连后恢复运行",
    "lastExit.stoppedAfterReattach": "主机重连后经 Electron 桥接停止",
    "lastExit.autostartFailed": "自启动失败。",
    "lastExit.profileBootFailed": "启动方案执行失败。",

    "log.serviceExited": "托管服务 {name} 已退出（{exit}）。",
    "log.serviceStarted": "托管服务 {name} 已启动，pid 为 {pid}。",
    "log.serviceStartFailed": "托管服务 {name} 启动失败：{error}",
    "log.stdoutUpdated": "stdout 已更新",
    "log.stderrUpdated": "stderr 已更新",
    "log.stopRequested": "已请求停止 {name}。",
    "log.startRequested": "已请求启动 {name}。",
    "log.commandRequested": "已请求为 {name} 执行{label}命令。",
    "log.autoRestartFailed": "{name} 自动重启失败。",
    "log.autostartFailed": "{name} 自启动失败。",

    "internal.journaldStarting": "正在启动 journald 日志适配器。",
    "internal.journaldStderr": "journald 适配器错误输出。",
    "internal.journaldStartFailed": "journald 适配器无法启动。",
    "internal.journaldStopped": "journald 适配器已停止。",
    "internal.skipDockerLogs": "跳过 Docker 日志收集。",
    "internal.reservedPortsOccupied": "保留端口已被占用。",
    "internal.hydrating": "正在生成运行时快照。",
    "internal.performingAction": "正在执行进程操作。",
    "internal.onDemandScan": "正在按需执行实时主机扫描。",
    "internal.killRequested": "已请求终止观测进程。",
    "internal.updatingService": "正在更新托管服务。",
    "internal.creatingDraft": "正在创建托管服务草稿。",
    "internal.removingService": "正在移除托管服务。",
    "internal.applyingRule": "正在应用自动化规则。",
    "log.reattached": "Mewl 已从实时主机进程重新挂接 {name}，pid 为 {pid}。",
    "log.terminatedAfterReattach": "主机重连后，被挂接的主机进程 {name} 已被终止。",
    "log.discovered": "运行时扫描发现了 {args}。",
    "log.degradedKernel": "该进程上报了非运行中的内核状态。",

    "history.exited": "{name} 已退出",
    "history.jobCompleted": "{name} 运行成功完成",
    "history.jobFailed": "{name} 运行失败，退出码 {code}",
    "history.jobStopped": "{name} 在结束前被手动停止",
    "history.exitedUnexpectedly": "{name} 意外退出",
    "history.exitedDetail": "Mewl 已记录：{exit}",
    "history.restartLimitReached": "{name} 已达到重启策略上限",
    "history.restartLimitDetail": "自动{policy}重启在本次会话尝试 {count} 次后停止。",
    "history.queuedForRestart": "{name} 已排队等待自动重启",
    "history.queuedDetail": "重启策略 {policy} 正在进行第 {count}/{limit} 次启动重试。",
    "history.autoRestartFailed": "{name} 自动重启失败",
    "history.autoRestartFailedDetail": "基于策略的重启未能完成。",
    "history.startFailed": "{name} 启动失败",
    "history.autostartFailed": "{name} 自启动失败",
    "history.profileStartFailed": "{name} 启动方案执行失败",
    "history.started": "已启动 {name}",
    "history.startedDetailPolicy": "重启策略请求了新的启动。",
    "history.startedDetailProfile": "启动方案拉起了该托管服务。",
    "history.startedDetailRuntime": "运行时启动序列拉起了该托管服务。",
    "history.startedDetailManual": "托管启动操作拉起了该服务。",
    "history.stopped": "已停止 {name}",
    "history.stoppedDetailProfile": "安静模式方案执行了已配置的停止流程。",
    "history.stoppedDetailDocker": "Mewl 根据已保存的启动命令推导了 Docker 感知的停止流程。",
    "history.stoppedDetailDefault": "Mewl 为该服务执行了已配置的停止流程。",
    "history.stoppedDetailParked": "安静模式方案挂起了被跟踪的进程。",
    "history.stoppedDetailTracked": "Mewl 为该托管服务停止了被跟踪的进程。",
    "history.restarted": "已重启 {name}",
    "history.restartedDetailCommand": "Mewl 为该托管服务执行了已配置的重启命令。",
    "history.restartedDetailPolicy": "退出后，重启策略回收了该托管服务。",
    "history.restartedDetailFallback": "Mewl 完成了回退的停止/启动重启流程。",
    "history.autostartEnabled": "已启用 {name} 自启动",
    "history.autostartDisabled": "已停用 {name} 自启动",
    "history.autostartEnabledDetail": "该托管服务将在桌面运行时启动时自动拉起。",
    "history.autostartDisabledDetail": "该托管服务将不再在启动时自动拉起。",
    "history.watchEnabled": "已启用 {name} 端口监控",
    "history.watchDisabled": "已停用 {name} 端口监控",
    "history.watchEnabledDetail": "Mewl 将把该服务纳入端口监控扫描。",
    "history.watchDisabledDetail": "Mewl 将在端口监控扫描中停止跟踪该服务。",
    "history.profileEnabled": "已启用 {title}",
    "history.profileDisabled": "已停用 {title}",
    "history.profileEnabledDetail": "该方案已应用到其托管服务。",
    "history.profileDisabledDetail": "该方案已停用，后续自动化运行不再执行。",

    "alerts.portConflict.title": "检测到端口冲突",
    "alerts.portConflict.detail": "{count} 个实时绑定共用了同一保留端口。",
    "alerts.publicExposed.title": "存在公网可达监听",
    "alerts.publicExposed.detail": "{count} 个绑定可从 localhost 之外访问。",
    "alerts.hotProcess.title": "主机存在高负载进程",
    "alerts.hotProcess.detail": "{name} 当前 CPU 占用最高，达 {cpu}%。",
    "alerts.memoryPressure.title": "内存压力偏高",
    "alerts.memoryPressure.detail": "主机内存压力当前为 {value}%。",
    "alerts.gpuLoad.title": "GPU 负载偏高",
    "alerts.gpuLoad.detail": "主机 GPU 负载当前为 {value}。",
    "alerts.managedParked.title": "托管服务处于待机",
    "alerts.managedParked.detail": "{name} 已注册到 Mewl，可随时从桌面桥接启动。",
    "alerts.managedHot.title": "托管服务负载过高",
    "alerts.managedHot.cpuDetail": "{name} 当前 CPU 占用为 {cpu}%。",
    "alerts.managedHot.memoryDetail": "{name} 当前占用 {memory} MB 内存，可能需要关注。",
    "alerts.crashLoop.title": "托管服务可能陷入崩溃循环",
    "alerts.crashLoop.detail": "{name} 在过去两小时内记录了 {failures} 次失败和 {retries} 次策略重试。",
    "alerts.orphanedPort.title": "保留端口被其他进程占用",
    "alerts.orphanedPort.detail": "{name} 期望使用端口 {port}，但当前实时绑定属于另一个进程。",
    "alerts.healthy.title": "实时主机快照状态良好",
    "alerts.healthy.detail": "最新扫描未发现直接的端口冲突或压力激增。",

    "metrics.cpu.label": "主机 CPU",
    "metrics.cpu.detail": "来自 CPU 轮询的实时采样。",
    "metrics.memory.label": "内存压力",
    "metrics.memory.detail": "已使用 {used} MB / 共 {total} MB。",
    "metrics.disk.label": "磁盘活动",
    "metrics.disk.detail": "根文件系统使用率。",
    "metrics.network.label": "网络流量",
    "metrics.network.detail": "活动接口观测到 {throughput}。",
    "metrics.gpu.label": "GPU 负载",
    "metrics.gpu.unavailable": "不可用",
    "gpu.detail.vram": "{name} 正在使用 {used} / {total} 显存。",
    "gpu.detail.utilization": "{name} 正在提供实时利用率采样。",
    "gpu.detail.drmBusy": "来自 DRM 主机遥测的 {card} 占用采样。",
    "gpu.detail.drmVram": "{card} 正在使用 {used} / {total} 显存。",
    "gpu.unavailableDetail": "当前主机桥接暂时无法获取 GPU 遥测数据。",

    "ports.note.conflict": "多个实时进程当前绑定在该主机端口上。",
    "ports.note.public": "监听器可从回环接口之外访问。",
    "ports.note.discovered": "监听器由实时主机扫描发现。",

    "processes.description.discoveredCwd": "从 {cwd} 发现的 {runtime} 进程。",
    "processes.description.discovered": "由实时主机扫描发现的 {runtime} 进程。",
    "processes.lastExitDiscovered": "实时发现的进程没有可用的退出历史。",

    "review.legacyCommand": "启动命令由旧的 command/args 格式导入，请在托管页复核。",
    "review.defaultDescription": "描述仍在使用默认占位文案，建议补充实际的服务说明。",
    "review.cwdFallback": "工作目录由旧配置回退为 `.`，请确认是否正确。",
    "review.nameInherited": "服务名看起来仍沿用了旧配置键，建议改为更友好的名称。",

    "default.description": "为 Mewl 桌面桥接注册的托管命令。",
    "default.profileDetail": "Electron 运行时桥接的托管启动方案。",
    "default.profileCadence": "手动方案",

    "rules.autostartTitle": "{name} 自启动",
    "rules.autostartDetail": "托管工作区启动时自动拉起 {name}。",
    "rules.cadence.sessionStart": "会话启动",
    "rules.watchTitle": "{name} 端口监控",
    "rules.watchDetail": "将 {name} 纳入端口绑定扫描与冲突汇总。",
    "rules.cadence.liveScan": "实时扫描",

    "errors.executableNotFound": "找不到托管可执行文件：{path}",
    "errors.executableNotOnPath": "托管可执行文件“{command}”不在已配置的 PATH 中。",
    "errors.scriptNotFound": "找不到托管脚本：{path}",
    "errors.commandRequired": "托管服务需要先填写命令才能运行。",
    "errors.executableTokenRequired": "托管服务命令必须以真实的可执行文件名开头。",
    "errors.unmatchedQuote": "托管命令解析发现未闭合的引号。",
    "errors.portsOccupied": "{name} 无法启动，保留端口 {ports} 已被占用。",
    "errors.alreadyRunning": "服务已在运行中。",
    "errors.alreadyStopped": "服务已处于停止状态。",
    "errors.killOnlyObserved": "终止操作只支持实时观测到的进程。",
    "errors.killInvalidPid": "观测进程的 pid 无效。",
    "errors.killManagedPid": "该 pid 属于托管服务。请使用托管的启动、停止或重启控制。",
    "errors.processGone": "该观测进程已不在运行。",
    "errors.unsupportedAction": "不支持的操作：{action}",
    "errors.serviceNotConfigured": "只有已配置的 Mewl 托管服务才能通过桌面桥接控制。",
    "errors.serviceNotEditable": "只有已配置的 Mewl 托管服务才能通过桌面桥接编辑。",
    "errors.nameAndStartRequired": "托管服务需要同时提供名称和启动命令。",
    "errors.startCommandRequired": "托管服务需要先填写启动命令才能保存。",
    "errors.profileNotFound": "在 mewl.services.json 中找不到请求的启动方案。",
    "errors.ruleNotManaged": "该自动化规则不受 Electron 桥接管理。",

    "messages.scanCompleted": "实时主机扫描完成。",
    "messages.killedObserved": "已终止观测进程 {name}（pid {pid}）。",
    "messages.started": "已启动 {name}。",
    "messages.stopped": "已停止 {name}。",
    "messages.restarted": "已重启 {name}。",
    "messages.reviewCleared": "{name} 不再需要旧配置清理复核。",
    "messages.settingsUpdated": "{name} 的设置已更新。",
    "messages.alreadyManaged": "{name} 已被 Mewl 托管。",
    "messages.nowManaged": "{name} 已交由 Mewl 托管。",
    "messages.alreadyRemoved": "该托管服务已被移除。",
    "messages.nowObservedOnly": "{name} 已恢复为仅观测状态。",
    "messages.profileEnabled": "{title} 已启用。",
    "messages.profileDisabled": "{title} 已停用。",

    "tray.show": "显示 Mewl",
    "tray.quit": "退出 Mewl",
    "tray.tooltip": "Mewl — 本地运维仪表盘",
  },
};

// The locale starts as English and follows the renderer once it mounts.
// 语言初始为英文，渲染进程挂载后跟随其设置。
let runtimeLocale = "en";

const runtimeLocaleListeners = new Set();

function setRuntimeLocale(locale) {
  if (locale === "zh" || locale === "en") {
    runtimeLocale = locale;
  }

  // Main-process surfaces that bake labels at creation time (the tray menu)
  // rebuild themselves when the locale flips.
  // 在创建时固化文案的主进程界面（托盘菜单）在语言切换时自行重建。
  for (const listener of runtimeLocaleListeners) {
    try {
      listener(runtimeLocale);
    } catch (_error) {
      // Locale listeners are UI refresh hints and never block a locale write.
      // 语言监听器只是界面刷新提示，不能阻塞语言写入。
    }
  }
}

function onRuntimeLocaleChanged(listener) {
  runtimeLocaleListeners.add(listener);
  return () => {
    runtimeLocaleListeners.delete(listener);
  };
}

function rt(key, params) {
  const dictionary = runtimeDictionaries[runtimeLocale] ?? runtimeDictionaries.en;
  const template = dictionary[key] ?? runtimeDictionaries.en[key] ?? key;

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)?\|([^}]*)\}|\{(\w+)\}/g, (_match, countKey, forms, key) => {
    if (forms !== undefined) {
      const [first, second] = forms.split(",");
      // A single form is a bare plural suffix; two forms are singular/plural.
      // 单一形式表示纯复数后缀；两种形式依次为单数/复数。
      const count = Number(countKey ? params[countKey] : params.count);
      const isSingular = count === 1;

      if (second === undefined) {
        return isSingular ? "" : first;
      }

      return isSingular ? first : second;
    }

    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function createLogBroker({
  maxEvents,
  flushDelayMs,
}) {
  const state = {
    events: [],
    eventIds: new Set(),
    pending: [],
    flushTimer: null,
    listener: null,
    adapters: [],
    started: false,
  };

  const flush = () => {
    state.flushTimer = null;

    if (!state.listener || state.pending.length === 0) {
      state.pending = [];
      return;
    }

    const batch = state.pending.slice();
    state.pending = [];
    state.listener(batch);
  };

  const queueFlush = () => {
    if (state.flushTimer) {
      return;
    }

    state.flushTimer = setTimeout(flush, flushDelayMs);
  };

  return {
    emit(event, { broadcast = false } = {}) {
      if (!event || typeof event.id !== "string" || state.eventIds.has(event.id)) {
        return;
      }

      state.eventIds.add(event.id);
      state.events.push(event);

      while (state.events.length > maxEvents) {
        const removed = state.events.shift();
        if (removed?.id) {
          state.eventIds.delete(removed.id);
        }
      }

      if (broadcast) {
        state.pending.push(event);
        queueFlush();
      }
    },
    getSnapshot() {
      return state.events.slice();
    },
    setListener(listener) {
      state.listener = typeof listener === "function" ? listener : null;
    },
    registerAdapter(adapter) {
      state.adapters.push(adapter);
    },
    async ensureStarted() {
      if (state.started) {
        return;
      }

      state.started = true;
      for (const adapter of state.adapters) {
        try {
          await adapter.start();
        } catch (error) {
          state.started = true;
          throw error;
        }
      }
    },
    async stop() {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }

      for (const adapter of state.adapters) {
        try {
          await adapter.stop();
        } catch (_error) {
          // Swallow shutdown cleanup failures to avoid blocking app quit.
          // 吞掉关闭时的清理失败，避免阻塞应用退出。
        }
      }
    },
  };
}

const logBroker = createLogBroker({
  maxEvents: unifiedLogLimit,
  flushDelayMs: unifiedLogFlushDelayMs,
});

function formatInternalLogMessage(args = []) {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }

      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }

      try {
        return JSON.stringify(arg);
      } catch (_error) {
        return String(arg);
      }
    })
    .join(" ");
}

function rememberUnifiedLogEvent(event, { broadcast = false } = {}) {
  logBroker.emit(event, { broadcast });
  // Every unified event also lands in the on-disk daily log files, so the
  // workspace stream is reconstructable after the app closes.
  // 每条统一事件同时落入按天拆分的日志文件，应用关闭后仍可回溯。
  logFileSink.queueWrite(event);
}

function getUnifiedLogSnapshot() {
  return logBroker.getSnapshot();
}

function setRuntimeLogBatchListener(listener) {
  logBroker.setListener(listener);
}

function normalizeConsolaLevel(type) {
  if (type === "fatal" || type === "error" || type === "warn" || type === "log" || type === "info" || type === "success" || type === "debug" || type === "trace") {
    return type;
  }

  return "info";
}

const mewlLogger = createConsola({
  level: process.env.NODE_ENV === "development" ? 4 : 3,
  reporters: [
    {
      log(logObj) {
        rememberUnifiedLogEvent(
          {
            id: `internal-${logObj.date?.toISOString?.() ?? new Date().toISOString()}-${logObj.tag || "mewl"}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: logObj.date?.toISOString?.() ?? new Date().toISOString(),
            level: normalizeConsolaLevel(logObj.type),
            source: logObj.tag || "mewl",
            sourceLabel: logObj.tag || "mewl",
            category: "internal",
            message: formatInternalLogMessage(logObj.args),
          },
          { broadcast: true },
        );
      },
    },
  ],
});

const runtimeLogger = mewlLogger.withTag("runtime");
const processManagerLogger = mewlLogger.withTag("process-manager");
const automationLogger = mewlLogger.withTag("automation");
const portsLogger = mewlLogger.withTag("ports");

function normalizeJournaldLevel(priority) {
  const value = Number.parseInt(priority, 10);

  if (!Number.isFinite(value)) {
    return "info";
  }

  if (value <= 2) {
    return "fatal";
  }

  if (value === 3) {
    return "error";
  }

  if (value === 4) {
    return "warn";
  }

  if (value >= 7) {
    return "debug";
  }

  return "info";
}

function createJournaldAdapter() {
  let child = null;
  let buffer = "";
  let started = false;
  let stopping = false;

  const emitLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const payload = JSON.parse(trimmed);
      const timestampMicros = Number.parseInt(payload.__REALTIME_TIMESTAMP || "", 10);
      const timestamp = Number.isFinite(timestampMicros)
        ? new Date(Math.floor(timestampMicros / 1000)).toISOString()
        : new Date().toISOString();
      const serviceName =
        payload.SYSLOG_IDENTIFIER ||
        payload._SYSTEMD_UNIT ||
        payload._COMM ||
        "system";
      const message =
        typeof payload.MESSAGE === "string"
          ? payload.MESSAGE
          : payload.MESSAGE == null
            ? ""
            : String(payload.MESSAGE);

      if (!message) {
        return;
      }

      rememberUnifiedLogEvent(
        {
          id: `journald-${payload.__CURSOR || `${timestamp}-${Math.random().toString(36).slice(2, 8)}`}`,
          timestamp,
          level: normalizeJournaldLevel(payload.PRIORITY),
          source: serviceName,
          sourceLabel: serviceName,
          category: "system",
          message,
          stream: "system",
        },
        { broadcast: true },
      );
    } catch (_error) {
      // Ignore partial or malformed journal lines without taking down the adapter.
      // 忽略不完整或损坏的日志行，避免整个适配器失效。
    }
  };

  const consumeBuffer = () => {
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      emitLine(line);
    }
  };

  return {
    name: "journald",
    async start() {
      if (started || process.platform !== "linux") {
        return;
      }

      started = true;
      stopping = false;
      runtimeLogger.info(rt("internal.journaldStarting"));
      child = spawn(
        "journalctl",
        ["-f", "-n", "120", "-o", "json", "--no-pager"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        buffer += chunk;
        consumeBuffer();
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        const message = String(chunk).trim();
        if (message) {
          runtimeLogger.debug(rt("internal.journaldStderr"), { message });
        }
      });

      child.on("error", (error) => {
        runtimeLogger.warn(rt("internal.journaldStartFailed"), {
          message: error.message,
        });
      });

      child.on("exit", (code, signal) => {
        child = null;
        buffer = "";

        if (!stopping) {
          runtimeLogger.warn(rt("internal.journaldStopped"), {
            code,
            signal,
          });
        }
      });
    },
    async stop() {
      stopping = true;
      if (child && child.exitCode === null) {
        child.kill("SIGTERM");
      }
      child = null;
      buffer = "";
      started = false;
    },
  };
}

logBroker.registerAdapter(createJournaldAdapter());

function getConfigRootPath() {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support");
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

const serviceConfigPath = path.join(getConfigRootPath(), "mewl", serviceConfigFileName);
const metricHistoryFilePath = path.join(getConfigRootPath(), "mewl", "metrics-history.json");
const portHistoryFilePath = path.join(getConfigRootPath(), "mewl", "port-history.json");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeManagedServiceKind(value, commandLine = "") {
  if (managedServiceKinds.has(value)) {
    return value;
  }

  const command = String(commandLine || "").trim().toLowerCase();
  if (!command) {
    return "command";
  }

  if (command.startsWith("docker compose ") || command === "docker compose" || command.startsWith("docker-compose ")) {
    return "docker";
  }

  const [firstToken = ""] = command.split(/\s+/);
  const extension = path.extname(firstToken);
  if (scriptInterpreterByExtension[extension]) {
    return "script";
  }

  return "command";
}

function formatStamp(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function createLogEntry(level, text) {
  return createTimedLogEntry(level, text);
}

function createTimedLogEntry(level, text, timestamp = new Date().toISOString()) {
  return {
    id: `live-log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stamp: formatStamp(new Date(timestamp)),
    timestamp,
    level,
    text,
  };
}

function createAutomationHistoryEntry({
  title,
  detail,
  outcome,
  source,
  serviceId,
  serviceName,
}) {
  return {
    id: `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stamp: new Date().toISOString(),
    title,
    detail,
    outcome,
    source,
    serviceId,
    serviceName,
  };
}

function createAlert({
  id,
  title,
  detail,
  severity,
  stamp = "now",
  serviceId,
  serviceName,
  category,
}) {
  return {
    id,
    title,
    detail,
    severity,
    stamp,
    serviceId,
    serviceName,
    category,
  };
}

function normalizeAlertTimestamp(stamp) {
  if (!stamp || stamp === "now") {
    return new Date().toISOString();
  }

  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function rememberAlertEvents(alerts) {
  for (const alert of alerts) {
    rememberUnifiedLogEvent({
      id: `alert-${alert.id}`,
      timestamp: normalizeAlertTimestamp(alert.stamp),
      level:
        alert.severity === "critical"
          ? "error"
          : alert.severity === "warning"
            ? "warn"
            : "info",
      source: alert.category || "runtime",
      sourceLabel: alert.serviceName || alert.category || "runtime",
      category: "alert",
      message: `${alert.title}: ${alert.detail}`,
      serviceId: alert.serviceId,
      serviceName: alert.serviceName,
    });
  }
}

function rememberManagedInspectorLogs(services) {
  for (const service of services) {
    for (const entry of service.logs.stdout) {
      rememberUnifiedLogEvent({
        id: `managed-${service.id}-stdout-${entry.id}`,
        timestamp: entry.timestamp || new Date().toISOString(),
        level: normalizeProcessLevelToUnified(entry.level),
        source: service.id,
        sourceLabel: service.name,
        category: "managed-stdout",
        message: entry.text,
        serviceId: service.id,
        serviceName: service.name,
        stream: "stdout",
      });
    }

    for (const entry of service.logs.stderr) {
      rememberUnifiedLogEvent({
        id: `managed-${service.id}-stderr-${entry.id}`,
        timestamp: entry.timestamp || new Date().toISOString(),
        level: normalizeProcessLevelToUnified(entry.level),
        source: service.id,
        sourceLabel: service.name,
        category: "managed-stderr",
        message: entry.text,
        serviceId: service.id,
        serviceName: service.name,
        stream: "stderr",
      });
    }
  }
}

function normalizeDockerLogLine(rawLine) {
  const line = String(rawLine || "").trim();
  if (!line) {
    return null;
  }

  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)\s+(.*)$/);
  if (match) {
    return {
      timestamp: match[1],
      message: match[2] || line,
    };
  }

  return {
    timestamp: new Date().toISOString(),
    message: line,
  };
}

async function collectManagedDockerLogs(service) {
  const commandLine = getManagedDockerLogCommand(service);
  if (!commandLine) {
    return;
  }

  const serviceState = getManagedState(service.id);
  const cwd = resolveServiceCwd(service.cwd);
  const env = buildManagedEnvironment(service);
  const { executable, args } = await resolveCommandSpec(commandLine, env.PATH, cwd);

  try {
    const result = await execFileAsync(executable, args, {
      cwd,
      env,
      maxBuffer: 12 * 1024 * 1024,
    });

    const lines = String(result.stdout || "")
      .split(/\r?\n/)
      .map(normalizeDockerLogLine)
      .filter(Boolean);

    for (const line of lines) {
      const fingerprint = `${line.timestamp}:${line.message}`;
      if (serviceState.dockerLogFingerprints.has(fingerprint)) {
        continue;
      }

      serviceState.dockerLogFingerprints.add(fingerprint);
      if (serviceState.dockerLogFingerprints.size > 200) {
        const [first] = serviceState.dockerLogFingerprints;
        if (first) {
          serviceState.dockerLogFingerprints.delete(first);
        }
      }

      const entry = createTimedLogEntry("info", line.message, line.timestamp);
      appendManagedLogEntry(serviceState.logs, "stdout", entry, service, { emitUnified: false });
      rememberUnifiedLogEvent(
        {
          id: `container-${service.id}-${entry.id}`,
          timestamp: line.timestamp,
          level: "info",
          source: service.id,
          sourceLabel: service.name,
          category: "container",
          message: line.message,
          serviceId: service.id,
          serviceName: service.name,
        },
        { broadcast: true },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Docker logs could not be collected.";
    portsLogger.debug(rt("internal.skipDockerLogs"), {
      serviceId: service.id,
      serviceName: service.name,
      message,
    });
  }
}

function trimAutomationHistory(entries) {
  return entries.slice(0, automationHistoryLimit);
}

// Job terminal state persists in the service config so completed/failed,
// exit codes, and run counts survive restarts; the in-memory state map only
// seeds from it when pristine.
// 任务终态持久化在服务配置中，使 completed/failed、退出码与运行次数跨
// 重启存续；内存状态表只在初始为空时从中回填。
async function persistJobRunState(serviceId, lastRunExit, jobRunCount) {
  const config = await loadManagedConfig();
  const services = config.services.map((service) =>
    service.id === serviceId ? { ...service, lastRunExit, jobRunCount } : service,
  );
  await saveManagedConfig({ ...config, services });
}

function seedJobStateFromConfig(services) {
  for (const service of services) {
    if (service.lifecycle !== "job") {
      continue;
    }

    const serviceState = getManagedState(service.id);
    if (serviceState.lastRunExit === null && Number.isFinite(service.lastRunExit)) {
      serviceState.lastRunExit = service.lastRunExit;
    }
    if (serviceState.jobRunCount === 0 && service.jobRunCount > 0) {
      serviceState.jobRunCount = service.jobRunCount;
    }
  }
}

function hoursSinceStamp(stamp) {
  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - parsed) / (1000 * 60 * 60);
}

function normalizeRestartPolicy(value) {
  return value === "always" || value === "on-failure" ? value : "manual";
}

function normalizeRestartLimit(value) {
  if (!Number.isFinite(value)) {
    return defaultRestartLimit;
  }

  return clamp(Math.round(value), 1, 10);
}

function rememberMetricSample(metric) {
  const current = metricHistoryState.get(metric.id) ?? [];
  const next = [...current, metric.value].slice(-metricHistoryLimit);
  metricHistoryState.set(metric.id, next);
  return next;
}

// --- Persistent metric + port history ---------------------------------------
// The renderer polls every few seconds, but trend data must survive restarts,
// so the main process keeps its own cadence and flushes to disk. hydrate calls
// also feed the ring with a throttle so the very first minutes after boot are
// not empty.
// 渲染层每几秒轮询一次，但趋势数据必须跨重启存续，因此主进程维护自己的
// 采样节奏并落盘。hydrate 调用也会按节流写入环形缓冲，保证开机后最初
// 几分钟不为空。

function pushMetricHistorySample(sample) {
  const samples = persistentMetricHistory.samples;
  const last = samples[samples.length - 1];
  if (last && sample.t - last.t < metricSampleIntervalMs / 2) {
    return;
  }

  samples.push(sample);
  const cutoff = Date.now() - metricHistoryWindowMs;
  while (samples.length > 0 && samples[0].t < cutoff) {
    samples.shift();
  }

  metricHistoryDirty = true;
}

function sampleMetricsIntoHistory(metrics) {
  pushMetricHistorySample({
    t: Date.now(),
    cpu: metrics.cpu.value,
    memory: metrics.memory.value,
    disk: metrics.disk.value,
    network: metrics.network.value,
    gpu: metrics.gpu.available ? metrics.gpu.value : null,
  });
}

function downsampleMetricSamples(samples) {
  if (samples.length <= monitorWindowPointLimit) {
    return samples;
  }

  const step = samples.length / monitorWindowPointLimit;
  const picked = [];
  for (let index = 0; index < samples.length; index += step) {
    picked.push(samples[Math.floor(index)]);
  }

  if (picked[picked.length - 1] !== samples[samples.length - 1]) {
    picked.push(samples[samples.length - 1]);
  }

  return picked;
}

function buildWindowedMonitorHistory(metrics, monitorWindow) {
  const range = monitorWindowRanges[monitorWindow] ?? monitorWindowRanges["1h"];
  const cutoff = Date.now() - range;
  const windowSamples = downsampleMetricSamples(
    persistentMetricHistory.samples.filter((sample) => sample.t >= cutoff),
  );

  // Feed the live sample through the same throttle so hydrate-driven views and
  // the background sampler share one ring.
  // 实时样本走同一节流入口，使 hydrate 驱动的视图与后台采样共享一个环形缓冲。
  sampleMetricsIntoHistory(metrics);
  const liveSample = {
    cpu: metrics.cpu.value,
    memory: metrics.memory.value,
    disk: metrics.disk.value,
    network: metrics.network.value,
    gpu: metrics.gpu.available ? metrics.gpu.value : null,
  };

  const seriesById = {
    cpu: windowSamples.map((sample) => sample.cpu),
    memory: windowSamples.map((sample) => sample.memory),
    disk: windowSamples.map((sample) => sample.disk),
    network: windowSamples.map((sample) => sample.network),
    gpu: windowSamples.map((sample) => sample.gpu ?? 0),
  };
  seriesById.cpu.push(liveSample.cpu);
  seriesById.memory.push(liveSample.memory);
  seriesById.disk.push(liveSample.disk);
  seriesById.network.push(liveSample.network);
  seriesById.gpu.push(liveSample.gpu ?? 0);

  return [metrics.cpu, metrics.memory, metrics.disk, metrics.network, metrics.gpu].map(
    (metric) => ({
      id: metric.id,
      label: metric.label,
      detail: metric.detail,
      values: seriesById[metric.id] ?? [],
      displayValue: metric.displayValue,
      available: metric.available,
    }),
  );
}

async function sampleHostMetricsIntoHistory() {
  try {
    const [cpuPercent, networkUsage, diskPercent, gpuUsage] = await Promise.all([
      sampleCpuUsage(),
      sampleNetworkUsage(),
      readDiskUsage(),
      sampleGpuUsage(),
    ]);
    const memoryPercent = clamp(
      Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
      0,
      100,
    );

    pushMetricHistorySample({
      t: Date.now(),
      cpu: cpuPercent,
      memory: memoryPercent,
      disk: diskPercent,
      network: networkUsage.percent,
      gpu: gpuUsage.available ? gpuUsage.percent : null,
    });
  } catch (_error) {
    // A missed background sample leaves the ring intact; the next tick
    // continues the series.
    // 一次后台采样失败不影响已有序列，下一个 tick 继续追加。
  }
}

// --- Port usage history ------------------------------------------------------

function recordPortHistoryEvent(event, binding) {
  portHistoryEvents.push({
    id: `port-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    event,
    port: binding.port,
    protocol: binding.protocol,
    pid: binding.pid,
    processName: binding.processName || `pid-${binding.pid}`,
  });

  while (portHistoryEvents.length > portHistoryEventLimit) {
    portHistoryEvents.shift();
  }

  portHistoryDirty = true;
}

async function watchPortBindingChanges() {
  try {
    const bindings = await readPortBindings();
    const currentKeys = new Map();

    for (const binding of bindings) {
      currentKeys.set(`${binding.protocol}:${binding.port}:${binding.pid}`, binding);
    }

    if (previousPortBindingKeys) {
      for (const [key, binding] of currentKeys) {
        if (!previousPortBindingKeys.has(key)) {
          recordPortHistoryEvent("bound", binding);
        }
      }

      for (const [key, binding] of previousPortBindingKeys) {
        if (!currentKeys.has(key)) {
          recordPortHistoryEvent("released", binding);
        }
      }
    }

    previousPortBindingKeys = currentKeys;
  } catch (_error) {
    // Keep the previous snapshot on a failed scan so a transient lsof miss
    // does not emit a wave of false "released" events.
    // 扫描失败时保留上一份快照，避免一次偶发的 lsof 失败
    // 触发一波虚假的 released 事件。
  }
}

function getRecentPortHistory(port, protocol) {
  return portHistoryEvents
    .filter((event) => event.port === port && event.protocol === protocol)
    .slice(-portHistoryPerPortLimit)
    .reverse();
}

// --- History persistence -----------------------------------------------------

async function loadHistoryFiles() {
  try {
    const raw = await fs.readFile(metricHistoryFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.samples)) {
      const cutoff = Date.now() - metricHistoryWindowMs;
      persistentMetricHistory.samples = parsed.samples.filter(
        (sample) => sample && Number.isFinite(sample.t),
      );
      while (persistentMetricHistory.samples.length > 0 && persistentMetricHistory.samples[0].t < cutoff) {
        persistentMetricHistory.samples.shift();
      }
    }
  } catch (_error) {
    persistentMetricHistory.samples = [];
  }

  try {
    const raw = await fs.readFile(portHistoryFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.events)) {
      portHistoryEvents.push(...parsed.events.slice(-portHistoryEventLimit));
    }
  } catch (_error) {
    // A missing port history file is the normal first-run state.
    // 端口历史文件缺失是正常的首次运行状态。
  }

  metricHistoryDirty = false;
  portHistoryDirty = false;
}

// Write-through JSON state via tmp+rename so a crash mid-write can never
// leave a truncated file behind (history and services config are read back
// on next boot). The tmp name is unique per write: concurrent writers share
// the directory, and a fixed name would let one rename steal another's file.
// 通过 tmp+rename 写 JSON 状态，崩溃时的半截写入不会留下被截断的文件
//（历史与服务配置都会在下次启动时读回）。tmp 名每次唯一：并发写入共享
// 目录，固定名字会让一次 rename 拿走别人的文件。
async function writeFileAtomic(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function saveHistoryFiles() {
  const retentionCutoff = Date.now() - getSettings().historyRetentionDays * 24 * 60 * 60 * 1000;

  if (metricHistoryDirty) {
    const cutoff = Math.max(retentionCutoff, Date.now() - metricHistoryWindowMs);
    persistentMetricHistory.samples = persistentMetricHistory.samples.filter(
      (sample) => sample.t >= cutoff,
    );
    await writeFileAtomic(
      metricHistoryFilePath,
      `${JSON.stringify({ samples: persistentMetricHistory.samples }, null, 2)}\n`,
    );
    metricHistoryDirty = false;
  }

  if (portHistoryDirty) {
    const cutoffTime = Date.parse(new Date(retentionCutoff).toISOString());
    const retained = portHistoryEvents.filter(
      (event) => Date.parse(event.timestamp) >= cutoffTime,
    );
    portHistoryEvents.length = 0;
    portHistoryEvents.push(...retained.slice(-portHistoryEventLimit));
    await writeFileAtomic(
      portHistoryFilePath,
      `${JSON.stringify({ events: portHistoryEvents }, null, 2)}\n`,
    );
    portHistoryDirty = false;
  }
}

function ensureHistoryTimers() {
  if (historyTimersInitialized) {
    return;
  }

  historyTimersInitialized = true;
  void loadHistoryFiles();

  metricSampleTimer = setInterval(() => {
    void sampleHostMetricsIntoHistory();
  }, metricSampleIntervalMs);

  metricFlushTimer = setInterval(() => {
    void saveHistoryFiles();
  }, metricHistoryFlushIntervalMs);

  portWatchTimer = setInterval(() => {
    void watchPortBindingChanges();
  }, portWatchIntervalMs);
}

async function stopHistoryTimers() {
  if (metricSampleTimer) {
    clearInterval(metricSampleTimer);
    metricSampleTimer = null;
  }

  if (metricFlushTimer) {
    clearInterval(metricFlushTimer);
    metricFlushTimer = null;
  }

  if (portWatchTimer) {
    clearInterval(portWatchTimer);
    portWatchTimer = null;
  }

  await saveHistoryFiles();
}

function isSafeEnvKey(key) {
  return /^[A-Z_][A-Z0-9_]*$/i.test(key);
}

// Service-defined env vars ride along in the saved config and merge over the
// inherited environment at spawn time. Keys follow the portable env-var shape;
// values are coerced to strings so JSON quirks never reach the child process.
// 服务自定义环境变量随配置保存，并在 spawn 时合并覆盖继承环境。
// 键遵循可移植的环境变量命名；值统一转为字符串，避免 JSON 的类型
// 怪癖泄漏进子进程。
function sanitizeServiceEnv(env) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => isSafeEnvKey(key) && typeof value !== "object")
      .map(([key, value]) => [key, String(value)]),
  );
}

function trimLogEntries(entries) {
  return entries.slice(-managedLogTailLimit);
}

function normalizeProcessLevelToUnified(level) {
  if (level === "error") {
    return "error";
  }

  if (level === "warning") {
    return "warn";
  }

  if (level === "debug") {
    return "debug";
  }

  return "info";
}

function appendManagedLogEntry(logs, stream, entry, service, options = {}) {
  const { emitUnified = true } = options;
  logs[stream] = trimLogEntries([...logs[stream], entry]);

  if (!service || !emitUnified) {
    return;
  }

  rememberUnifiedLogEvent(
    {
      id: `managed-${service.id}-${stream}-${entry.id}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      level: normalizeProcessLevelToUnified(entry.level),
      source: service.id,
      sourceLabel: service.name,
      category: stream === "stderr" ? "managed-stderr" : "managed-stdout",
      message: entry.text,
      serviceId: service.id,
      serviceName: service.name,
      stream,
    },
    { broadcast: true },
  );
}

function getManagedState(serviceId) {
  const existing = managedServiceState.get(serviceId);
  if (existing) {
    return existing;
  }

  const created = {
    child: null,
    adoptedPid: null,
    starting: false,
    stopping: false,
    restartCount: 0,
    policyRestartCount: 0,
    launchSource: "runtime",
    startedAt: null,
    lastExit: rt("lastExit.noRecent"),
    lastHeartbeat: rt("heartbeat.idle"),
    // One-time job bookkeeping: how many times the job ran this install and
    // the exit code of the most recent finished run.
    // 一次性任务账目：该任务安装以来的运行次数与最近一次结束运行的退出码。
    jobRunCount: 0,
    lastRunExit: null,
    // Pid whose reattachment was already logged. Text-based dedup broke when
    // the message template changed language, and again once the log tail
    // trimmed the old line away.
    // 已记录过重挂接日志的 pid。按日志文本去重在语言切换或日志被裁剪后都会失效，
    // 因此改用状态标记。
    reattachLoggedPid: null,
    logs: {
      stdout: [],
      stderr: [],
    },
    dockerLogFingerprints: new Set(),
  };
  managedServiceState.set(serviceId, created);
  return created;
}

async function runCommand(command, args) {
  const result = await execFileAsync(command, args, {
    maxBuffer: 12 * 1024 * 1024,
  });

  return result.stdout.trim();
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function ensureManagedConfigFile() {
  const configDirectory = path.dirname(serviceConfigPath);
  await fs.mkdir(configDirectory, { recursive: true });

  if (!(await pathExists(serviceConfigPath))) {
    await fs.writeFile(serviceConfigPath, `${JSON.stringify(emptyManagedConfig, null, 2)}\n`, "utf8");
  }
}

function parseCommandLine(commandLine) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const character of commandLine.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (quote) {
    throw new Error(rt("errors.unmatchedQuote"));
  }

  if (escaping) {
    current += "\\";
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

async function resolveExecutable(command, envPath, cwd) {
  if (!command || /\s/.test(command.trim())) {
    throw new Error(rt("errors.executableTokenRequired"));
  }

  if (command.includes(path.sep)) {
    const resolvedPath = path.isAbsolute(command) ? command : path.resolve(cwd || process.cwd(), command);

    if (!(await pathExists(resolvedPath))) {
      throw new Error(rt("errors.executableNotFound", { path: resolvedPath }));
    }

    return resolvedPath;
  }

  const searchPaths = (envPath || process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);

  for (const searchPath of searchPaths) {
    const candidate = path.join(searchPath, command);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(rt("errors.executableNotOnPath", { command }));
}

async function resolveScriptCommand(command, args, envPath, cwd) {
  const scriptPath = path.isAbsolute(command) ? command : path.resolve(cwd || process.cwd(), command);

  if (!(await pathExists(scriptPath))) {
    throw new Error(rt("errors.scriptNotFound", { path: scriptPath }));
  }

  const extension = path.extname(scriptPath).toLowerCase();
  const interpreterName = scriptInterpreterByExtension[extension];
  if (!interpreterName) {
    return null;
  }

  const executable = await resolveExecutable(interpreterName, envPath, cwd);
  return {
    executable,
    args: [scriptPath, ...args],
  };
}

async function resolveCommandSpec(commandLine, envPath, cwd) {
  const [command, ...args] = parseCommandLine(commandLine);
  if (!command) {
    throw new Error(rt("errors.commandRequired"));
  }

  if (command.includes(path.sep) || command.startsWith(".")) {
    const scriptCommand = await resolveScriptCommand(command, args, envPath, cwd);
    if (scriptCommand) {
      return scriptCommand;
    }
  }

  const executable = await resolveExecutable(command, envPath, cwd);
  return {
    executable,
    args,
  };
}

async function runCommandWithFallback(commands) {
  for (const candidate of commands) {
    try {
      return await runCommand(candidate.command, candidate.args);
    } catch (error) {
      if (candidate === commands[commands.length - 1]) {
        throw error;
      }
    }
  }

  return "";
}

function readCpuTimes() {
  return os.cpus().reduce(
    (totals, cpu) => {
      totals.idle += cpu.times.idle;
      totals.total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return totals;
    },
    { idle: 0, total: 0 },
  );
}

async function sampleCpuUsage() {
  const start = readCpuTimes();
  await delay(sampleDelayMs);
  const end = readCpuTimes();
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;

  if (totalDelta <= 0) {
    return 0;
  }

  return clamp(Math.round((1 - idleDelta / totalDelta) * 100), 0, 100);
}

async function readNetworkBytes() {
  const interfacesPath = "/sys/class/net";
  const interfaceNames = await fs.readdir(interfacesPath);
  const activeNames = interfaceNames.filter((name) => name !== "lo");

  const counters = await Promise.all(
    activeNames.map(async (name) => {
      try {
        const [rxBytes, txBytes] = await Promise.all([
          fs.readFile(path.join(interfacesPath, name, "statistics", "rx_bytes"), "utf8"),
          fs.readFile(path.join(interfacesPath, name, "statistics", "tx_bytes"), "utf8"),
        ]);

        return Number(rxBytes.trim()) + Number(txBytes.trim());
      } catch (_error) {
        return 0;
      }
    }),
  );

  return counters.reduce((sum, value) => sum + value, 0);
}

function formatThroughput(bytesPerSecond) {
  if (bytesPerSecond >= oneMegabyte) {
    return `${(bytesPerSecond / oneMegabyte).toFixed(1)} MB/s`;
  }

  return `${Math.round(bytesPerSecond / 1024)} KB/s`;
}

async function sampleNetworkUsage() {
  const start = await readNetworkBytes();
  await delay(sampleDelayMs);
  const end = await readNetworkBytes();
  const bytesPerSecond = Math.max(0, Math.round(((end - start) * 1000) / sampleDelayMs));
  const percent = clamp(Math.round((bytesPerSecond / (5 * oneMegabyte)) * 100), 0, 100);

  return {
    percent,
    bytesPerSecond,
  };
}

function formatMegabytes(value) {
  return `${Math.round(value)} MB`;
}

async function sampleNvidiaGpuUsage() {
  try {
    const output = await runCommand("nvidia-smi", [
      "--query-gpu=utilization.gpu,memory.used,memory.total,name",
      "--format=csv,noheader,nounits",
    ]);
    const candidates = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",").map((part) => part.trim());
        if (parts.length < 4) {
          return null;
        }

        const [utilization, memoryUsed, memoryTotal, ...nameParts] = parts;
        const percent = clamp(Number.parseInt(utilization, 10) || 0, 0, 100);
        const usedMb = Number.parseInt(memoryUsed, 10) || 0;
        const totalMb = Number.parseInt(memoryTotal, 10) || 0;
        const name = nameParts.join(", ") || "NVIDIA GPU";

        return {
          percent,
          detail:
            totalMb > 0
              ? rt("gpu.detail.vram", {
                  name,
                  used: formatMegabytes(usedMb),
                  total: formatMegabytes(totalMb),
                })
              : rt("gpu.detail.utilization", { name }),
        };
      })
      .filter(Boolean);

    if (candidates.length === 0) {
      return null;
    }

    return candidates.sort((left, right) => right.percent - left.percent)[0];
  } catch (_error) {
    return null;
  }
}

async function sampleSysfsGpuUsage() {
  try {
    const drmEntries = await fs.readdir("/sys/class/drm");
    const candidates = await Promise.all(
      drmEntries
        .filter((entry) => /^card\d+$/.test(entry))
        .map(async (entry) => {
          const busyPath = path.join("/sys/class/drm", entry, "device", "gpu_busy_percent");
          if (!(await pathExists(busyPath))) {
            return null;
          }

          const busyPercent = clamp(
            Number.parseInt((await fs.readFile(busyPath, "utf8")).trim(), 10) || 0,
            0,
            100,
          );
          const usedVramPath = path.join(
            "/sys/class/drm",
            entry,
            "device",
            "mem_info_vram_used",
          );
          const totalVramPath = path.join(
            "/sys/class/drm",
            entry,
            "device",
            "mem_info_vram_total",
          );

          let detail = rt("gpu.detail.drmBusy", { card: entry.toUpperCase() });

          if ((await pathExists(usedVramPath)) && (await pathExists(totalVramPath))) {
            const [usedBytes, totalBytes] = await Promise.all([
              fs.readFile(usedVramPath, "utf8"),
              fs.readFile(totalVramPath, "utf8"),
            ]);
            const usedMb = Number.parseInt(usedBytes.trim(), 10) / oneMegabyte;
            const totalMb = Number.parseInt(totalBytes.trim(), 10) / oneMegabyte;

            if (Number.isFinite(usedMb) && Number.isFinite(totalMb) && totalMb > 0) {
              detail = rt("gpu.detail.drmVram", {
                card: entry.toUpperCase(),
                used: formatMegabytes(usedMb),
                total: formatMegabytes(totalMb),
              });
            }
          }

          return {
            percent: busyPercent,
            detail,
          };
        }),
    );

    const liveSamples = candidates.filter(Boolean);
    if (liveSamples.length === 0) {
      return null;
    }

    return liveSamples.sort((left, right) => right.percent - left.percent)[0];
  } catch (_error) {
    return null;
  }
}

async function sampleGpuUsage() {
  const nvidiaSample = await sampleNvidiaGpuUsage();
  if (nvidiaSample) {
    return {
      available: true,
      ...nvidiaSample,
    };
  }

  const sysfsSample = await sampleSysfsGpuUsage();
  if (sysfsSample) {
    return {
      available: true,
      ...sysfsSample,
    };
  }

  return {
    available: false,
    percent: 0,
    detail: rt("gpu.unavailableDetail"),
  };
}

async function readDiskUsage() {
  const output = await runCommand("df", ["-kP", "/"]);
  const lines = output.split("\n").filter(Boolean);
  const fields = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
  const capacityField = fields[4] ?? "0%";

  return clamp(Number.parseInt(capacityField.replace("%", ""), 10) || 0, 0, 100);
}

function normalizeRuntime(command, args) {
  const joined = `${command} ${args}`.toLowerCase();

  if (joined.includes("electron")) {
    return "electron";
  }

  if (joined.includes("node")) {
    return "node";
  }

  if (joined.includes("python")) {
    return "python";
  }

  if (joined.includes("docker")) {
    return "docker";
  }

  if (joined.includes("chrome") || joined.includes("chromium") || joined.includes("firefox")) {
    return "browser";
  }

  return command.toLowerCase();
}

function createDockerComposeStopCommand(commandLine) {
  const tokens = parseCommandLine(commandLine);
  if (tokens.length < 3) {
    return "";
  }

  const usesLegacyCompose = tokens[0] === "docker-compose";
  const composeIndex = usesLegacyCompose ? 0 : tokens[0] === "docker" && tokens[1] === "compose" ? 1 : -1;
  if (composeIndex === -1) {
    return "";
  }

  const upIndex = tokens.findIndex((token, index) => index > composeIndex && token === "up");
  if (upIndex === -1) {
    return "";
  }

  const composePrefix = usesLegacyCompose ? ["docker-compose"] : ["docker", "compose"];
  const prefixOptions = tokens.slice(composeIndex + 1, upIndex);
  const trailingTokens = tokens.slice(upIndex + 1);
  const composeOptionsWithValues = new Set(["-f", "--file", "--project-directory", "-p", "--project-name", "--profile", "--env-file"]);
  const upOnlyFlags = new Set([
    "-d",
    "--detach",
    "--build",
    "--force-recreate",
    "--no-recreate",
    "--renew-anon-volumes",
    "--abort-on-container-exit",
    "--abort-on-container-failure",
    "--attach",
    "--attach-dependencies",
    "--always-recreate-deps",
    "--menu",
    "--no-attach",
    "--no-build",
    "--no-color",
    "--no-deps",
    "--no-log-prefix",
    "--pull",
    "--quiet-build",
    "--quiet-pull",
    "--remove-orphans",
    "--scale",
    "--timeout",
    "--timestamps",
    "--wait",
    "--wait-timeout",
  ]);

  const serviceNames = [];
  for (let index = 0; index < trailingTokens.length; index += 1) {
    const token = trailingTokens[index];
    if (!token.startsWith("-")) {
      serviceNames.push(token);
      continue;
    }

    if (composeOptionsWithValues.has(token)) {
      index += 1;
      continue;
    }

    if (upOnlyFlags.has(token)) {
      if (token === "--scale" || token === "--attach" || token === "--no-attach" || token === "--profile" || token === "--env-file") {
        index += 1;
      }
      continue;
    }

    return "";
  }

  return [...composePrefix, ...prefixOptions, "stop", ...serviceNames].join(" ");
}

function createDockerRunStopCommand(commandLine) {
  const tokens = parseCommandLine(commandLine);
  if (tokens.length < 2 || tokens[0] !== "docker" || tokens[1] !== "run") {
    return "";
  }

  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--name" && typeof tokens[index + 1] === "string" && tokens[index + 1].length > 0) {
      return `docker stop ${tokens[index + 1]}`;
    }

    if (token.startsWith("--name=")) {
      const name = token.slice("--name=".length);
      return name ? `docker stop ${name}` : "";
    }
  }

  return "";
}

function createDockerComposeLogCommand(commandLine) {
  const tokens = parseCommandLine(commandLine);
  if (tokens.length < 3) {
    return "";
  }

  const usesLegacyCompose = tokens[0] === "docker-compose";
  const composeIndex = usesLegacyCompose ? 0 : tokens[0] === "docker" && tokens[1] === "compose" ? 1 : -1;
  if (composeIndex === -1) {
    return "";
  }

  const upIndex = tokens.findIndex((token, index) => index > composeIndex && token === "up");
  if (upIndex === -1) {
    return "";
  }

  const composePrefix = usesLegacyCompose ? ["docker-compose"] : ["docker", "compose"];
  const prefixOptions = tokens.slice(composeIndex + 1, upIndex);
  const trailingTokens = tokens.slice(upIndex + 1);
  const composeOptionsWithValues = new Set(["-f", "--file", "--project-directory", "-p", "--project-name", "--profile", "--env-file"]);
  const upOnlyFlags = new Set([
    "-d",
    "--detach",
    "--build",
    "--force-recreate",
    "--no-recreate",
    "--renew-anon-volumes",
    "--abort-on-container-exit",
    "--abort-on-container-failure",
    "--attach",
    "--attach-dependencies",
    "--always-recreate-deps",
    "--menu",
    "--no-attach",
    "--no-build",
    "--no-color",
    "--no-deps",
    "--no-log-prefix",
    "--pull",
    "--quiet-build",
    "--quiet-pull",
    "--remove-orphans",
    "--scale",
    "--timeout",
    "--timestamps",
    "--wait",
    "--wait-timeout",
  ]);

  const serviceNames = [];
  for (let index = 0; index < trailingTokens.length; index += 1) {
    const token = trailingTokens[index];
    if (!token.startsWith("-")) {
      serviceNames.push(token);
      continue;
    }

    if (composeOptionsWithValues.has(token)) {
      index += 1;
      continue;
    }

    if (upOnlyFlags.has(token)) {
      if (token === "--scale" || token === "--attach" || token === "--no-attach" || token === "--profile" || token === "--env-file") {
        index += 1;
      }
      continue;
    }

    return "";
  }

  return [
    ...composePrefix,
    ...prefixOptions,
    "logs",
    "--timestamps",
    "--tail",
    "20",
    ...serviceNames,
  ].join(" ");
}

function createDockerRunLogCommand(commandLine) {
  const tokens = parseCommandLine(commandLine);
  if (tokens.length < 2 || tokens[0] !== "docker" || tokens[1] !== "run") {
    return "";
  }

  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--name" && typeof tokens[index + 1] === "string" && tokens[index + 1].length > 0) {
      return `docker logs --timestamps --tail 20 ${tokens[index + 1]}`;
    }

    if (token.startsWith("--name=")) {
      const name = token.slice("--name=".length);
      return name ? `docker logs --timestamps --tail 20 ${name}` : "";
    }
  }

  return "";
}

function getManagedStopCommand(service) {
  const explicitStopCommand = typeof service.stopCommand === "string" ? service.stopCommand.trim() : "";
  if (explicitStopCommand) {
    return explicitStopCommand;
  }

  if (service.kind !== "docker") {
    return "";
  }

  const startCommand = String(service.startCommand || "").trim();
  if (!startCommand) {
    return "";
  }

  try {
    return createDockerComposeStopCommand(startCommand) || createDockerRunStopCommand(startCommand);
  } catch (_error) {
    return "";
  }
}

function getManagedDockerLogCommand(service) {
  if (service.kind !== "docker") {
    return "";
  }

  const startCommand = String(service.startCommand || "").trim();
  if (!startCommand) {
    return "";
  }

  try {
    return createDockerComposeLogCommand(startCommand) || createDockerRunLogCommand(startCommand);
  } catch (_error) {
    return "";
  }
}

// Group values are persisted, so they stay in canonical English here;
// localizeGroup() re-renders them in the active language for display.
// 分组值会写入配置文件，因此这里保持规范英文；展示时由 localizeGroup()
// 按当前语言重新渲染。
function normalizeGroup(runtime, cwd) {
  if (cwd.includes("/PROJECTS/") || cwd.includes("/code/") || cwd.includes("/src/")) {
    return "workspace";
  }

  if (runtime === "browser") {
    return "browser";
  }

  if (runtime === "electron" || runtime === "node" || runtime === "python") {
    return "development";
  }

  return "system";
}

// Map a canonical group to the active language. Unknown values (for example
// groups persisted by older builds in another language) pass through as-is.
// 将规范分组映射为当前语言。未知取值（例如旧版本以其他语言持久化的分组）原样透传。
function localizeGroup(group) {
  if (typeof group !== "string" || group.length === 0) {
    return group;
  }

  const dictionaryKey = `group.${group}`;
  const localized = runtimeDictionaries[runtimeLocale]?.[dictionaryKey] ?? runtimeDictionaries.en[dictionaryKey];

  return localized ?? group;
}

function normalizeStatus(state) {
  if (state.includes("T") || state.includes("Z") || state.includes("X")) {
    return "degraded";
  }

  return "running";
}

function formatElapsed(raw) {
  if (!raw) {
    return rt("uptime.unknown");
  }

  if (raw.includes("-")) {
    const [days, rest] = raw.split("-");
    return `${days}d ${rest}`;
  }

  return raw;
}

function formatManagedElapsed(startedAt) {
  if (!startedAt) {
    return rt("uptime.stopped");
  }

  const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function inferExposure(target) {
  if (
    target.startsWith("127.0.0.1:") ||
    target.startsWith("[::1]:") ||
    target.startsWith("localhost:")
  ) {
    return "local";
  }

  if (
    target.startsWith("*:") ||
    target.startsWith("0.0.0.0:") ||
    target.startsWith("[::]:")
  ) {
    return "public";
  }

  return "internal";
}

async function readWorkingDirectory(pid) {
  try {
    return await fs.readlink(`/proc/${pid}/cwd`);
  } catch (_error) {
    return "";
  }
}

async function readProcessCommandLine(pid) {
  try {
    const rawValue = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
    return rawValue.split("\0").filter(Boolean);
  } catch (_error) {
    return [];
  }
}

async function readUserProcesses() {
  const username = os.userInfo().username;
  const output = await runCommand("ps", [
    "-u",
    username,
    "-o",
    "pid=",
    "-o",
    "ppid=",
    "-o",
    "comm=",
    "-o",
    "%cpu=",
    "-o",
    "rss=",
    "-o",
    "etime=",
    "-o",
    "state=",
    "-o",
    "args=",
    "--sort=-pcpu,-rss",
  ]);

  const rows = output.split("\n").filter(Boolean);
  const parsed = rows
    .map((row) => {
      const match = row.match(
        /^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/,
      );

      if (!match) {
        return null;
      }

      const [, pid, ppid, command, cpu, rss, elapsed, state, args] = match;

      return {
        pid: Number(pid),
        ppid: Number(ppid),
        command,
        args,
        cpu: Math.round(Number.parseFloat(cpu) || 0),
        memoryMb: Math.max(1, Math.round((Number.parseInt(rss, 10) || 0) / 1024)),
        elapsed,
        state,
      };
    })
    .filter(Boolean);

  return Promise.all(
    parsed.map(async (processRow) => ({
      ...processRow,
      cwd: await readWorkingDirectory(processRow.pid),
    })),
  );
}

function slugifyServiceId(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createManagedServiceId(name, services) {
  const baseId = slugifyServiceId(name) || "managed-process";
  let candidate = baseId;
  let index = 2;

  while (services.some((service) => service.id === candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }

  return candidate;
}

function createManagedServiceName(processRow) {
  const basename = path.basename(processRow.command || "").trim();
  return basename || processRow.command || `pid-${processRow.pid}`;
}

function getProcessExecutable(processRow) {
  const commandLine = typeof processRow.args === "string" ? processRow.args.trim() : "";
  if (!commandLine) {
    return processRow.command || "";
  }

  const [firstToken] = commandLine.split(/\s+/);
  return firstToken || processRow.command || "";
}

function getProcessFamilyName(processRow) {
  return path.basename(getProcessExecutable(processRow) || processRow.command || "").toLowerCase();
}

function isHelperProcessRow(processRow) {
  const commandName = path.basename(processRow.command || "").toLowerCase();
  const commandLine = typeof processRow.args === "string" ? processRow.args : "";

  return (
    commandName.includes("crashpad") ||
    commandLine.includes(" --type=") ||
    commandLine.startsWith("/proc/self/exe --type=")
  );
}

function isHelperManagedService(service) {
  const commandName = path.basename(service.startCommand || service.command || "").toLowerCase();
  return (
    commandName.includes("crashpad") ||
    service.startCommand === "/proc/self/exe" ||
    String(service.startCommand || service.command || "").includes(" --type=")
  );
}

function sanitizeManagedService(service) {
  if (!isHelperManagedService(service)) {
    return service;
  }

  return {
    ...service,
    kind: normalizeManagedServiceKind(service.kind, service.startCommand || service.command || ""),
    stopCommand: service.stopCommand ?? "",
    restartCommand: service.restartCommand ?? "",
  };
}

// Canonical English lookup for strings that get persisted. Config files and
// state comparisons must not depend on the active locale, so anything written
// to disk resolves from the English dictionary even while the UI runs in
// Chinese. Display-time localization re-maps these through rt()/reasonKeys.
// 面向持久化的规范英文取词函数。配置文件与状态比较不能依赖当前语言，
// 因此写入磁盘的内容一律取自英文词典，即使界面正运行在中文下。
// 展示时的本地化通过 rt()/reasonKeys 重新映射。
function ren(key, params) {
  const template = runtimeDictionaries.en[key] ?? key;

  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)?\|([^}]*)\}|\{(\w+)\}/g, (_match, countKey, forms, key) => {
    if (forms !== undefined) {
      const [first, second] = forms.split(",");
      const isSingular = Number(countKey ? params[countKey] : params.count) === 1;

      if (second === undefined) {
        return isSingular ? "" : first;
      }

      return isSingular ? first : second;
    }

    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

function getManagedReviewState(service, normalizedService, legacyCommandUsed) {
  const review =
    service.review && typeof service.review === "object" && !Array.isArray(service.review)
      ? service.review
      : null;
  // Reasons are fully derived from structural conditions and regenerated in a
  // canonical English form on every load. Previously stored reason text was
  // merged in here, which mixed languages after a locale switch and made the
  // config-change detection compare localized sentences. needsReview from an
  // explicit marker is still honored even without structural reasons.
  // 复核原因完全由结构条件推导，并在每次加载时以规范英文形式重新生成。
  // 旧实现会把已存储的原因文本合并进来，导致语言切换后中英混杂，
  // 也让配置变更检测去比较本地化句子。显式 needsReview 标记仍然生效。
  const reasonKeys = [];
  const reasons = [];

  if (legacyCommandUsed) {
    reasonKeys.push("review.legacyCommand");
    reasons.push(ren("review.legacyCommand"));
  }

  if (typeof service.description !== "string" || service.description.trim().length === 0) {
    reasonKeys.push("review.defaultDescription");
    reasons.push(ren("review.defaultDescription"));
  }

  if (typeof service.cwd !== "string" || service.cwd.trim().length === 0) {
    reasonKeys.push("review.cwdFallback");
    reasons.push(ren("review.cwdFallback"));
  }

  if (
    typeof service.name !== "string" ||
    service.name.trim().length === 0 ||
    service.name.trim() === service.id
  ) {
    reasonKeys.push("review.nameInherited");
    reasons.push(ren("review.nameInherited"));
  }

  const needsReview = review?.needsReview === true || reasons.length > 0;

  if (!needsReview) {
    return null;
  }

  return {
    needsReview: true,
    source: "legacy-config",
    reasons,
    reasonKeys,
  };
}

// Localize a stored review for display. Canonical entries carry a reasonKey
// and are re-rendered in the active language; legacy or hand-written reasons
// without keys are shown verbatim.
// 将存储的复核状态本地化后用于展示。带 reasonKey 的规范条目按当前语言重新渲染；
// 旧数据或手工编写、没有 key 的原因按原文显示。
function localizeManagedReview(review) {
  if (
    !review ||
    !Array.isArray(review.reasonKeys) ||
    review.reasonKeys.length === 0
  ) {
    return review ?? null;
  }

  return {
    ...review,
    reasons: review.reasonKeys.map((key) => rt(key)),
  };
}

function getManagedServiceDedupKey(service) {
  return [
    service.name.trim().toLowerCase(),
    resolveServiceCwd(service.cwd),
    service.startCommand || service.command || "",
  ].join("\u0000");
}

function findPromotableProcess(processRow, processByPid) {
  const familyName = getProcessFamilyName(processRow);
  let current = processRow;
  let promotable = isHelperProcessRow(processRow) ? null : processRow;
  const visited = new Set();

  while (current && !visited.has(current.pid)) {
    visited.add(current.pid);
    const parent = processByPid.get(current.ppid);

    if (!parent || getProcessFamilyName(parent) !== familyName) {
      break;
    }

    if (!isHelperProcessRow(parent)) {
      promotable = parent;
    }

    current = parent;
  }

  return promotable;
}

function parsePortFromTarget(target) {
  const match = target.match(/:(\d+)(?:\s+\(LISTEN\))?$/);
  return match ? Number(match[1]) : null;
}

async function readPortBindings() {
  const username = os.userInfo().username;
  const output = await runCommandWithFallback([
    {
      command: "lsof",
      args: ["-nP", "-u", username, "-iTCP", "-iUDP"],
    },
    {
      command: "ss",
      args: ["-lntup"],
    },
  ]);

  if (!output) {
    return [];
  }

  if (output.startsWith("COMMAND")) {
    return output
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/))
      .map((parts) => {
        const protocol = parts[7]?.toLowerCase() ?? "tcp";
        const target = parts.slice(8).join(" ").replace(/\s+\(LISTEN\)$/, "");
        const port = parsePortFromTarget(target);

        if (!port) {
          return null;
        }

        if (target.includes("->")) {
          return null;
        }

        if (protocol === "tcp" && !parts.slice(8).join(" ").includes("(LISTEN)")) {
          return null;
        }

        return {
          pid: Number(parts[1]),
          protocol,
          port,
          target,
          processName: parts[0] || "",
        };
      })
      .filter(Boolean);
  }

  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      const protocol = parts[0]?.toLowerCase();
      const localAddress = parts[4];
      const processDetails = parts.slice(6).join(" ");
      const pidMatch = processDetails.match(/pid=(\d+)/);
      const nameMatch = processDetails.match(/users:\(\("([^"]+)"/);
      const port = parsePortFromTarget(localAddress);

      if (!pidMatch || !port) {
        return null;
      }

      return {
        pid: Number(pidMatch[1]),
        protocol: protocol.startsWith("udp") ? "udp" : "tcp",
        port,
        target: localAddress,
        processName: nameMatch?.[1] || "",
      };
    })
    .filter(Boolean);
}

async function loadManagedConfig() {
  await ensureManagedConfigFile();

  try {
    const raw = await fs.readFile(serviceConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    const services = Array.isArray(parsed.services) ? parsed.services : [];
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
    const history = Array.isArray(parsed.history) ? parsed.history : [];
    const normalizedServices = [];
    const seenServiceKeys = new Set();
    let configChanged = false;

    for (const service of services.filter((item) => typeof item.id === "string")) {
      const originalArgs = Array.isArray(service.args)
        ? service.args.filter((value) => typeof value === "string")
        : [];
      const legacyCommand =
        typeof service.command === "string"
          ? [service.command, ...originalArgs].join(" ").trim()
          : "";
      const startCommand =
        typeof service.startCommand === "string" && service.startCommand.trim().length > 0
          ? service.startCommand.trim()
          : legacyCommand;

      if (!startCommand) {
        configChanged = true;
        continue;
      }

      const normalizedService = sanitizeManagedService({
        id: service.id,
        name: typeof service.name === "string" ? service.name : service.id,
        description:
          typeof service.description === "string"
            ? service.description
            : rt("default.description"),
        kind: normalizeManagedServiceKind(service.kind, startCommand),
        lifecycle: service.lifecycle === "job" ? "job" : "service",
        startCommand,
        stopCommand:
          typeof service.stopCommand === "string" ? service.stopCommand.trim() : "",
        restartCommand:
          typeof service.restartCommand === "string" ? service.restartCommand.trim() : "",
        cwd: typeof service.cwd === "string" ? service.cwd : ".",
        runtime: typeof service.runtime === "string" ? service.runtime : "",
        group: typeof service.group === "string" ? service.group : "managed",
        watchPorts: service.watchPorts !== false,
        autoStart: service.autoStart === true,
        restartPolicy:
          service.lifecycle === "job"
            ? "manual"
            : normalizeRestartPolicy(service.restartPolicy),
        restartLimit: normalizeRestartLimit(service.restartLimit),
        // Job terminal state rides in the config so completed/failed status,
        // exit codes, and run counts survive app restarts.
        // 任务终态随配置保存，使 completed/failed 状态、退出码与运行次数
        // 在应用重启后仍然可见。
        lastRunExit:
          service.lifecycle === "job" && Number.isFinite(service.lastRunExit)
            ? service.lastRunExit
            : null,
        jobRunCount:
          service.lifecycle === "job" && Number.isFinite(service.jobRunCount)
            ? Math.max(0, Math.round(service.jobRunCount))
            : 0,
        ports: Array.isArray(service.ports)
          ? service.ports.filter((value) => Number.isInteger(value))
          : [],
        inheritEnv: Array.isArray(service.inheritEnv)
          ? service.inheritEnv.filter(
              (value) => typeof value === "string" && isSafeEnvKey(value),
            )
          : [...defaultInheritedEnvKeys],
        env:
          service.env && typeof service.env === "object" && !Array.isArray(service.env)
            ? Object.fromEntries(
                Object.entries(service.env).filter(
                  ([key, value]) => isSafeEnvKey(key) && typeof value === "string",
                ),
              )
            : {},
        titleColor:
          typeof service.titleColor === "string" ? service.titleColor : "default",
        icon: typeof service.icon === "string" ? service.icon : "server",
      });
      const review = getManagedReviewState(
        service,
        normalizedService,
        Boolean(legacyCommand && (!service.startCommand || String(service.startCommand).trim().length === 0)),
      );
      const normalizedServiceWithReview = review
        ? {
            ...normalizedService,
            review,
          }
        : normalizedService;

      const dedupKey = getManagedServiceDedupKey(normalizedServiceWithReview);
      if (seenServiceKeys.has(dedupKey)) {
        configChanged = true;
        continue;
      }

      seenServiceKeys.add(dedupKey);
      normalizedServices.push(normalizedServiceWithReview);

      if (
        normalizedServiceWithReview.kind !== normalizeManagedServiceKind(service.kind, startCommand) ||
        normalizedServiceWithReview.startCommand !== startCommand ||
        normalizedServiceWithReview.stopCommand !==
          (typeof service.stopCommand === "string" ? service.stopCommand.trim() : "") ||
        normalizedServiceWithReview.restartCommand !==
          (typeof service.restartCommand === "string" ? service.restartCommand.trim() : "") ||
        normalizedServiceWithReview.restartPolicy !== normalizeRestartPolicy(service.restartPolicy) ||
        normalizedServiceWithReview.restartLimit !== normalizeRestartLimit(service.restartLimit) ||
        Boolean(review) !== Boolean(service.review?.needsReview) ||
        JSON.stringify(review?.reasons ?? []) !== JSON.stringify(service.review?.reasons ?? [])
      ) {
        configChanged = true;
      }
    }

    const normalizedProfiles = profiles
      .filter((profile) => typeof profile.id === "string")
      .map((profile) => ({
        id: profile.id,
        title: typeof profile.title === "string" ? profile.title : profile.id,
        detail:
          typeof profile.detail === "string"
            ? profile.detail
            : rt("default.profileDetail"),
        cadence: typeof profile.cadence === "string" ? profile.cadence : rt("default.profileCadence"),
        enabled: profile.enabled === true,
        action: profile.action === "stop" ? "stop" : "start",
        serviceIds: Array.isArray(profile.serviceIds)
          ? profile.serviceIds.filter((value) => typeof value === "string")
          : [],
      }))
      .map((profile) => ({
        ...profile,
        serviceIds: profile.serviceIds.filter((serviceId) =>
          normalizedServices.some((service) => service.id === serviceId),
        ),
      }))
      .filter((profile) => profile.serviceIds.length > 0);

    const normalizedHistory = trimAutomationHistory(
      history
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => ({
          id:
            typeof entry.id === "string" && entry.id.length > 0
              ? entry.id
              : `automation-${Math.random().toString(36).slice(2, 8)}`,
          stamp:
            typeof entry.stamp === "string" && entry.stamp.length > 0
              ? entry.stamp
              : new Date().toISOString(),
          title:
            typeof entry.title === "string" && entry.title.length > 0
              ? entry.title
              : "Automation event",
          detail: typeof entry.detail === "string" ? entry.detail : "No detail recorded.",
          outcome:
            entry.outcome === "error" || entry.outcome === "warning" ? entry.outcome : "success",
          source:
            entry.source === "profile" ||
            entry.source === "policy" ||
            entry.source === "runtime"
              ? entry.source
              : "manual",
          serviceId: typeof entry.serviceId === "string" ? entry.serviceId : undefined,
          serviceName: typeof entry.serviceName === "string" ? entry.serviceName : undefined,
        })),
    );

    if (normalizedProfiles.length !== profiles.length) {
      configChanged = true;
    }

    if (JSON.stringify(normalizedHistory) !== JSON.stringify(history)) {
      configChanged = true;
    }

    if (configChanged) {
      await saveManagedConfig({
        services: normalizedServices,
        profiles: normalizedProfiles,
        history: normalizedHistory,
      });
    }

    return {
      services: normalizedServices,
      profiles: normalizedProfiles,
      history: normalizedHistory,
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return emptyManagedConfig;
    }

    throw error;
  }
}

async function saveManagedConfig(config) {
  await ensureManagedConfigFile();
  await writeFileAtomic(
    serviceConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

// Serialize config read-modify-write cycles. Job exits, automation events,
// and editor saves all load the config, mutate, and write back; without a
// queue, interleaved pairs silently drop whichever save lands first.
// 串行化配置的读-改-写循环。任务退出、自动化事件与编辑器保存都会
// 读取配置、修改并写回；没有队列时，交错的写对会静默丢失先落盘的一方。
let managedConfigWriteChain = Promise.resolve();

function withManagedConfigWrite(task) {
  const run = managedConfigWriteChain.then(task, task);
  managedConfigWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Unserialized core; callers that bundle multiple config writes must use
// withManagedConfigWrite and call this directly (nested queueing deadlocks).
// 非串行化核心；需要打包多次配置写入的调用方必须使用
// withManagedConfigWrite 并直接调用本函数（嵌套排队会死锁）。
async function recordAutomationHistoryEntry(entry) {
  const config = await loadManagedConfig();
  const createdEntry = createAutomationHistoryEntry(entry);
  config.history = trimAutomationHistory([createdEntry, ...config.history]);
  await saveManagedConfig(config);
  rememberUnifiedLogEvent(
    {
      id: `automation-${createdEntry.id}`,
      timestamp: createdEntry.stamp,
      level:
        createdEntry.outcome === "error"
          ? "error"
          : createdEntry.outcome === "warning"
            ? "warn"
            : "success",
      source: createdEntry.source,
      sourceLabel: createdEntry.serviceName || createdEntry.source,
      category: "automation",
      message: `${createdEntry.title}: ${createdEntry.detail}`,
      serviceId: createdEntry.serviceId,
      serviceName: createdEntry.serviceName,
    },
    { broadcast: true },
  );
  return createdEntry;
}

async function recordAutomationHistory(entry) {
  return withManagedConfigWrite(() => recordAutomationHistoryEntry(entry));
}

function resolveServiceCwd(relativeCwd) {
  const resolvedPath = path.isAbsolute(relativeCwd)
    ? relativeCwd
    : path.resolve(repoRoot, relativeCwd);
  return resolvedPath;
}

function markHeartbeat(serviceState, label) {
  serviceState.lastHeartbeat = label;
}

function shouldAutoRestart(service, code, signal) {
  if (service.restartPolicy === "always") {
    return true;
  }

  if (service.restartPolicy === "on-failure") {
    return code !== 0 || Boolean(signal);
  }

  return false;
}

async function handleManagedChildExit(service, serviceState, code, signal) {
  const wasStopping = serviceState.stopping;
  const shouldRestart =
    !wasStopping &&
    shouldAutoRestart(service, code, signal) &&
    serviceState.policyRestartCount < service.restartLimit;

  serviceState.child = null;
  serviceState.starting = false;
  serviceState.stopping = false;
  serviceState.startedAt = null;
  serviceState.lastExit =
    code === 0
      ? rt("lastExit.clean")
      : signal
        ? rt("lastExit.signal", { signal })
        : rt("lastExit.code", { code: code ?? rt("lastExit.unknownCode") });
  markHeartbeat(serviceState, rt("heartbeat.idle"));
  appendManagedLogEntry(
    serviceState.logs,
    code === 0 ? "stdout" : "stderr",
    createLogEntry(
      code === 0 ? "info" : "error",
      rt("log.serviceExited", { name: service.name, exit: serviceState.lastExit }),
    ),
    service,
  );

  if (!wasStopping) {
    if (service.lifecycle === "job") {
      if (serviceState.spawnFailed) {
        // The spawn "error" path already finalized this run; Node can still
        // emit a spurious exit afterwards, which must not double-count.
        // spawn 的 error 路径已为本次运行记账；Node 之后仍可能派发一次
        // exit，不能重复计数。
        serviceState.spawnFailed = false;
        return;
      }

      // Jobs record a finished run instead of an unexpected exit: exit 0 is a
      // successful completion, anything else is a failed run.
      // 任务记录的是一次结束的运行而非异常退出：exit 0 视为成功完成，
      // 其他退出码视为失败运行。
      serviceState.lastRunExit = code === null ? -1 : code;
      serviceState.jobRunCount += 1;
      // Persist terminal state and the history entry as one queued write pair
      // so a concurrently exiting job cannot interleave between them.
      // 把终态与历史记录作为一个排队的写对落盘，
      // 避免同时退出的任务在两者之间交错写入。
      await withManagedConfigWrite(async () => {
        await persistJobRunState(service.id, serviceState.lastRunExit, serviceState.jobRunCount);
        await recordAutomationHistoryEntry({
          title:
            code === 0
              ? rt("history.jobCompleted", { name: service.name })
              : rt("history.jobFailed", { name: service.name, code: code ?? -1 }),
          detail: rt("history.exitedDetail", { exit: serviceState.lastExit }),
          outcome: code === 0 ? "success" : "error",
          source: "runtime",
          serviceId: service.id,
          serviceName: service.name,
        });
      });
    } else {
      await recordAutomationHistory({
        title:
          code === 0
            ? rt("history.exited", { name: service.name })
            : rt("history.exitedUnexpectedly", { name: service.name }),
        detail: rt("history.exitedDetail", { exit: serviceState.lastExit }),
        outcome: code === 0 ? "warning" : "error",
        source: "runtime",
        serviceId: service.id,
        serviceName: service.name,
      });
    }
  } else if (service.lifecycle === "job") {
    // A manual stop is not a finished run: the previous completed/failed
    // verdict stays on record and only a history entry is written.
    // 手动停止不算一次结束的运行：保留上一次 completed/failed 的结论，
    // 只补一条历史记录。
    await recordAutomationHistory({
      title: rt("history.jobStopped", { name: service.name }),
      detail: rt("history.exitedDetail", { exit: serviceState.lastExit }),
      outcome: "warning",
      source: "runtime",
      serviceId: service.id,
      serviceName: service.name,
    });
  }

  if (!shouldRestart) {
    if (!wasStopping && service.restartPolicy !== "manual" && serviceState.policyRestartCount >= service.restartLimit) {
      await recordAutomationHistory({
        title: rt("history.restartLimitReached", { name: service.name }),
        detail: rt("history.restartLimitDetail", {
          policy: service.restartPolicy,
          count: service.restartLimit,
        }),
        outcome: "error",
        source: "policy",
        serviceId: service.id,
        serviceName: service.name,
      });
    }
    return;
  }

  serviceState.policyRestartCount += 1;
  serviceState.restartCount += 1;
  await recordAutomationHistory({
    title: rt("history.queuedForRestart", { name: service.name }),
    detail: rt("history.queuedDetail", {
      policy: service.restartPolicy,
      count: serviceState.policyRestartCount,
      limit: service.restartLimit,
    }),
    outcome: "warning",
    source: "policy",
    serviceId: service.id,
    serviceName: service.name,
  });

  try {
    await startManagedService(service, "policy");
  } catch (error) {
    serviceState.starting = false;
    serviceState.lastExit = error instanceof Error ? error.message : rt("lastExit.autoRestartFailed");
    appendManagedLogEntry(
      serviceState.logs,
      "stderr",
      createLogEntry(
        "error",
        error instanceof Error
          ? error.message
          : rt("log.autoRestartFailed", { name: service.name }),
      ),
      service,
    );
    await recordAutomationHistory({
      title: rt("history.autoRestartFailed", { name: service.name }),
      detail:
        error instanceof Error ? error.message : rt("history.autoRestartFailedDetail"),
      outcome: "error",
      source: "policy",
      serviceId: service.id,
      serviceName: service.name,
    });
  }
}

function attachChildListeners(service, serviceState, child) {
  child.stdout?.on("data", (chunk) => {
    appendManagedLogEntry(
      serviceState.logs,
      "stdout",
      createLogEntry("info", String(chunk).trim() || rt("log.stdoutUpdated")),
      service,
    );
    markHeartbeat(serviceState, rt("heartbeat.live"));
  });

  child.stderr?.on("data", (chunk) => {
    appendManagedLogEntry(
      serviceState.logs,
      "stderr",
      createLogEntry("warning", String(chunk).trim() || rt("log.stderrUpdated")),
      service,
    );
    markHeartbeat(serviceState, rt("heartbeat.live"));
  });

  child.on("spawn", () => {
    serviceState.starting = false;
    serviceState.stopping = false;
    serviceState.startedAt = Date.now();
    serviceState.lastExit = rt("lastExit.noRecent");
    // A successful launch supersedes any earlier reserved-port failure.
    // 启动成功即覆盖此前可能存在的保留端口失败标记。
    serviceState.reservedPortsBlocked = false;
    if (serviceState.launchSource !== "policy") {
      serviceState.policyRestartCount = 0;
    }
    markHeartbeat(serviceState, rt("heartbeat.justNow"));
    appendManagedLogEntry(
      serviceState.logs,
      "stdout",
      createLogEntry(
        "info",
        rt("log.serviceStarted", { name: service.name, pid: child.pid }),
      ),
      service,
    );
  });

  child.on("error", (error) => {
    serviceState.child = null;
    serviceState.starting = false;
    serviceState.stopping = false;
    serviceState.startedAt = null;
    serviceState.lastExit = error.message;
    markHeartbeat(serviceState, rt("heartbeat.idle"));
    appendManagedLogEntry(
      serviceState.logs,
      "stderr",
      createLogEntry(
        "error",
        rt("log.serviceStartFailed", { name: service.name, error: error.message }),
      ),
      service,
    );
    if (service.lifecycle === "job") {
      // A job that never spawned is still a failed run: ENOENT and friends
      // often fire "error" without a usable "exit".
      // 从未成功 spawn 的任务也算一次失败运行：ENOENT 等错误常常只触发
      // error 而没有可用的 exit。
      serviceState.spawnFailed = true;
      serviceState.lastRunExit = -1;
      serviceState.jobRunCount += 1;
      void withManagedConfigWrite(async () => {
        await persistJobRunState(service.id, -1, serviceState.jobRunCount);
        await recordAutomationHistoryEntry({
          title: rt("history.jobFailed", { name: service.name, code: -1 }),
          detail: error.message,
          outcome: "error",
          source: serviceState.launchSource === "policy" ? "policy" : serviceState.launchSource,
          serviceId: service.id,
          serviceName: service.name,
        });
      });
      return;
    }
    void recordAutomationHistory({
      title: rt("history.startFailed", { name: service.name }),
      detail: error.message,
      outcome: "error",
      source: serviceState.launchSource === "policy" ? "policy" : serviceState.launchSource,
      serviceId: service.id,
      serviceName: service.name,
    });
  });

  child.on("exit", (code, signal) => {
    void handleManagedChildExit(service, serviceState, code, signal);
  });
}

function isServiceRunning(serviceState) {
  if (serviceState.child && serviceState.child.exitCode === null) {
    return true;
  }

  if (Number.isInteger(serviceState.adoptedPid)) {
    try {
      process.kill(serviceState.adoptedPid, 0);
      return true;
    } catch (_error) {
      serviceState.adoptedPid = null;
    }
  }

  return false;
}

function buildManagedEnvironment(service) {
  const env = {};

  for (const key of service.inheritEnv) {
    if (typeof process.env[key] === "string") {
      env[key] = process.env[key];
    }
  }

  return {
    ...env,
    ...service.env,
  };
}

async function assertReservedPortsAvailable(service, ignoredPids = []) {
  if (!service.watchPorts || service.ports.length === 0) {
    return;
  }

  const ignoredPidSet = new Set(ignoredPids.filter((value) => Number.isInteger(value)));
  const bindings = await readPortBindings();
  const occupiedPorts = new Set(
    bindings
      .filter(
        (binding) =>
          service.ports.includes(binding.port) && !ignoredPidSet.has(binding.pid),
      )
      .map((binding) => binding.port),
  );

  if (occupiedPorts.size > 0) {
    portsLogger.warn(rt("internal.reservedPortsOccupied"), {
      serviceId: service.id,
      serviceName: service.name,
      ports: Array.from(occupiedPorts),
    });
    // Flag the state instead of matching the localized error text later:
    // syncManagedServiceState needs to know why the last launch failed, and the
    // sentence changes with the active locale.
    // 用状态标记代替事后匹配本地化错误文本：syncManagedServiceState 需要
    // 知道上次启动失败的原因，而错误句子会随当前语言变化。
    getManagedState(service.id).reservedPortsBlocked = true;
    throw new Error(
      rt("errors.portsOccupied", {
        name: service.name,
        ports: Array.from(occupiedPorts).join(", "),
        count: occupiedPorts.size,
      }),
    );
  }
}

async function runManagedCommand(service, commandLine, label) {
  const serviceState = getManagedState(service.id);
  const cwd = resolveServiceCwd(service.cwd);
  const env = buildManagedEnvironment(service);
  const { executable, args } = await resolveCommandSpec(commandLine, env.PATH, cwd);

  appendManagedLogEntry(
    serviceState.logs,
    "stdout",
    createLogEntry("info", rt("log.commandRequested", { label, name: service.name })),
    service,
  );

  try {
    const result = await execFileAsync(executable, args, {
      cwd,
      env,
      maxBuffer: 12 * 1024 * 1024,
    });

    if (typeof result.stdout === "string" && result.stdout.trim()) {
      appendManagedLogEntry(
        serviceState.logs,
        "stdout",
        createLogEntry("info", result.stdout.trim()),
        service,
      );
    }

    if (typeof result.stderr === "string" && result.stderr.trim()) {
      appendManagedLogEntry(
        serviceState.logs,
        "stderr",
        createLogEntry("warning", result.stderr.trim()),
        service,
      );
    }

    markHeartbeat(serviceState, rt("heartbeat.justNow"));
    return;
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";

    if (stdout) {
      appendManagedLogEntry(serviceState.logs, "stdout", createLogEntry("info", stdout), service);
    }

    if (stderr) {
      appendManagedLogEntry(serviceState.logs, "stderr", createLogEntry("error", stderr), service);
    }

    throw error;
  }
}

async function startManagedService(service, source = "manual") {
  const serviceState = getManagedState(service.id);
  if (isServiceRunning(serviceState)) {
    return rt("errors.alreadyRunning");
  }

  serviceState.starting = true;
  serviceState.stopping = false;
  serviceState.adoptedPid = null;
  serviceState.launchSource = source;
  if (source !== "policy") {
    serviceState.policyRestartCount = 0;
  }
  appendManagedLogEntry(
    serviceState.logs,
    "stdout",
    createLogEntry("info", rt("log.startRequested", { name: service.name })),
    service,
  );

  const cwd = resolveServiceCwd(service.cwd);
  const env = buildManagedEnvironment(service);
  const { executable, args } = await resolveCommandSpec(service.startCommand, env.PATH, cwd);
  await assertReservedPortsAvailable(service, [serviceState.adoptedPid]);

  // Each run starts with a clean spawn ledger; a previous ENOENT-style
  // failure must not swallow this run's exit accounting.
  // 每次运行重置 spawn 记账；上一次 ENOENT 类失败不能吞掉
  // 本次运行的退出记账。
  serviceState.spawnFailed = false;

  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    shell: false,
  });

  serviceState.child = child;
  attachChildListeners(service, serviceState, child);
  await recordAutomationHistory({
    title: rt("history.started", { name: service.name }),
    detail:
      source === "policy"
        ? rt("history.startedDetailPolicy")
        : source === "profile"
          ? rt("history.startedDetailProfile")
          : source === "runtime"
            ? rt("history.startedDetailRuntime")
            : rt("history.startedDetailManual"),
    outcome: "success",
    source,
    serviceId: service.id,
    serviceName: service.name,
  });
  return rt("messages.started", { name: service.name });
}

function waitForChildExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.once("exit", () => resolve());
  });
}

async function waitForPidExit(pid, timeoutMs = 4000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(pid, 0);
      await delay(120);
    } catch (_error) {
      return;
    }
  }
}

function findAdoptableProcessForService(service, rawProcesses, portMap) {
  const expectedCommand = String(service.startCommand || "").trim();
  const expectedCwd = resolveServiceCwd(service.cwd);

  return (
    rawProcesses.find((processRow) => {
      const discoveredPorts = (portMap.get(processRow.pid) ?? []).map((binding) => binding.port);
      const sharesReservedPort =
        service.ports.length > 0 && discoveredPorts.some((port) => service.ports.includes(port));

      return (
        processRow.cwd === expectedCwd &&
        (processRow.args.trim() === expectedCommand || sharesReservedPort)
      );
    }) ?? null
  );
}

function syncManagedServiceState(service, rawProcesses, portMap) {
  const serviceState = getManagedState(service.id);

  if (serviceState.child && serviceState.child.exitCode === null) {
    serviceState.adoptedPid = null;
    return {
      serviceState,
      adoptedProcess: null,
    };
  }

  const adoptedProcess = findAdoptableProcessForService(service, rawProcesses, portMap);
  serviceState.adoptedPid = adoptedProcess?.pid ?? null;

  if (adoptedProcess) {
    if (serviceState.reservedPortsBlocked === true) {
      serviceState.reservedPortsBlocked = false;
      serviceState.lastExit = rt("lastExit.runningAfterReattach");
    }

    // Dedup by pid in the service state, not by comparing the localized log
    // text: the sentence changes with the active locale, and the tail-trimmed
    // log can drop the original line entirely.
    // 以 service state 中的 pid 去重，而不是比对本地化后的日志文本：
    // 句子会随语言变化，且日志被裁剪后原文本可能已不存在。
    if (serviceState.reattachLoggedPid !== adoptedProcess.pid) {
      serviceState.reattachLoggedPid = adoptedProcess.pid;
      appendManagedLogEntry(
        serviceState.logs,
        "stdout",
        createLogEntry(
          "info",
          rt("log.reattached", { name: service.name, pid: adoptedProcess.pid }),
        ),
        service,
      );
    }
  }

  return {
    serviceState,
    adoptedProcess,
  };
}

function buildAutomationRules(services, profiles) {
  return [
    ...services.flatMap((service) => [
    {
      id: `service-autostart:${service.id}`,
      title: rt("rules.autostartTitle", { name: service.name }),
      detail: rt("rules.autostartDetail", { name: service.name }),
      cadence: rt("rules.cadence.sessionStart"),
      enabled: service.autoStart,
    },
    {
      id: `service-watch:${service.id}`,
      title: rt("rules.watchTitle", { name: service.name }),
      detail: rt("rules.watchDetail", { name: service.name }),
      cadence: rt("rules.cadence.liveScan"),
      enabled: service.watchPorts,
    },
    ]),
    ...profiles.map((profile) => ({
      id: `profile:${profile.id}`,
      title: profile.title,
      detail: profile.detail,
      cadence: profile.cadence,
      enabled: profile.enabled,
    })),
  ];
}

async function stopManagedService(service, source = "manual") {
  const serviceState = getManagedState(service.id);
  const stopCommand = getManagedStopCommand(service);
  if (stopCommand) {
    serviceState.stopping = true;
    appendManagedLogEntry(
      serviceState.logs,
      "stdout",
      createLogEntry("warning", rt("log.stopRequested", { name: service.name })),
      service,
    );
    await runManagedCommand(service, stopCommand, rt("action.stop"));

    if (serviceState.child && serviceState.child.exitCode === null) {
      await Promise.race([waitForChildExit(serviceState.child), delay(4000)]);
    } else if (serviceState.adoptedPid) {
      await waitForPidExit(serviceState.adoptedPid);
    }

    await recordAutomationHistory({
      title: rt("history.stopped", { name: service.name }),
      detail:
        source === "profile"
          ? rt("history.stoppedDetailProfile")
          : service.kind === "docker" && !service.stopCommand
            ? rt("history.stoppedDetailDocker")
            : rt("history.stoppedDetailDefault"),
      outcome: "success",
      source,
      serviceId: service.id,
      serviceName: service.name,
    });

    return rt("messages.stopped", { name: service.name });
  }

  if (!isServiceRunning(serviceState)) {
    return rt("errors.alreadyStopped");
  }

  serviceState.stopping = true;
  appendManagedLogEntry(
    serviceState.logs,
    "stdout",
    createLogEntry("warning", rt("log.stopRequested", { name: service.name })),
    service,
  );

  const child = serviceState.child;
  if (child && child.exitCode === null) {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-child.pid, "SIGTERM");
    }

    await Promise.race([
      waitForChildExit(child),
      delay(4000).then(() => {
        if (child.exitCode === null) {
          if (process.platform === "win32") {
            child.kill("SIGKILL");
          } else {
            process.kill(-child.pid, "SIGKILL");
          }
        }
      }),
    ]);
  } else if (serviceState.adoptedPid) {
    const adoptedPid = serviceState.adoptedPid;
    process.kill(adoptedPid, "SIGTERM");
    await waitForPidExit(adoptedPid);

    try {
      process.kill(adoptedPid, 0);
      process.kill(adoptedPid, "SIGKILL");
      await waitForPidExit(adoptedPid, 1200);
    } catch (_error) {
      // The adopted process exited during the graceful drain window.
      // 被挂接的进程在优雅排空窗口内自行退出了。
    }

    serviceState.adoptedPid = null;
    serviceState.lastExit = rt("lastExit.stoppedAfterReattach");
    markHeartbeat(serviceState, rt("heartbeat.idle"));
    appendManagedLogEntry(
      serviceState.logs,
      "stdout",
      createLogEntry(
        "info",
        rt("log.terminatedAfterReattach", { name: service.name }),
      ),
      service,
    );
  }

  await recordAutomationHistory({
    title: rt("history.stopped", { name: service.name }),
    detail:
      source === "profile"
        ? rt("history.stoppedDetailParked")
        : rt("history.stoppedDetailTracked"),
    outcome: "success",
    source,
    serviceId: service.id,
    serviceName: service.name,
  });

  return rt("messages.stopped", { name: service.name });
}

async function restartManagedService(service, source = "manual") {
  const serviceState = getManagedState(service.id);
  serviceState.restartCount += 1;

  if (service.restartCommand) {
    await runManagedCommand(service, service.restartCommand, rt("action.restart"));
    await recordAutomationHistory({
      title: rt("history.restarted", { name: service.name }),
      detail: rt("history.restartedDetailCommand"),
      outcome: "success",
      source,
      serviceId: service.id,
      serviceName: service.name,
    });
    return rt("messages.restarted", { name: service.name });
  }

  if (isServiceRunning(serviceState)) {
    await stopManagedService(service, source);
  }

  await startManagedService(service, source);
  await recordAutomationHistory({
    title: rt("history.restarted", { name: service.name }),
    detail:
      source === "policy"
        ? rt("history.restartedDetailPolicy")
        : rt("history.restartedDetailFallback"),
    outcome: "success",
    source,
    serviceId: service.id,
    serviceName: service.name,
  });
  return rt("messages.restarted", { name: service.name });
}

async function killObservedProcess(processId) {
  await initializeManagedServices();

  const pidMatch = /^pid-(\d+)$/.exec(processId);
  if (!pidMatch) {
    throw new Error(rt("errors.killOnlyObserved"));
  }

  const pid = Number(pidMatch[1]);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(rt("errors.killInvalidPid"));
  }

  const [rawProcesses, config] = await Promise.all([readUserProcesses(), loadManagedConfig()]);
  const managedPids = new Set();
  const emptyPortMap = new Map();

  for (const service of config.services) {
    const { serviceState } = syncManagedServiceState(service, rawProcesses, emptyPortMap);
    const childPid = serviceState.child?.pid ?? serviceState.adoptedPid ?? null;
    if (childPid) {
      managedPids.add(childPid);
    }
  }

  if (managedPids.has(pid)) {
    throw new Error(rt("errors.killManagedPid"));
  }

  const observedProcess = rawProcesses.find(
    (processRow) => processRow.pid === pid && !isHelperProcessRow(processRow),
  );
  if (!observedProcess) {
    throw new Error(rt("errors.processGone"));
  }

  process.kill(pid, "SIGTERM");
  await waitForPidExit(pid, 1800);

  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
    await waitForPidExit(pid, 1200);
  } catch (_error) {
    // The observed process exited during the graceful drain window.
    // 观测进程在优雅排空窗口内自行退出了。
  }

  return {
    snapshot: await hydrateRuntimeSnapshot(),
    message: rt("messages.killedObserved", {
      name: path.basename(observedProcess.command),
      pid,
    }),
  };
}

async function initializeManagedServices() {
  if (autoStartInitialized) {
    return;
  }

  autoStartInitialized = true;
  await logFileSink.initLogFilePersistence();
  ensureHistoryTimers();
  const { services, profiles } = await loadManagedConfig();

  // Jobs are one-shot by definition: auto-starting them on every launch would
  // re-run finished work, so they are excluded from the boot sweep.
  // 任务是一次性的：每次启动都自动拉起会重复执行已完成的工作，
  // 因此把它们排除出开机扫描。
  for (const service of services.filter((item) => item.autoStart && item.lifecycle !== "job")) {
    try {
      await startManagedService(service, "runtime");
    } catch (error) {
      const serviceState = getManagedState(service.id);
      serviceState.starting = false;
      serviceState.lastExit = error instanceof Error ? error.message : rt("lastExit.autostartFailed");
      appendManagedLogEntry(
        serviceState.logs,
        "stderr",
        createLogEntry(
          "error",
          error instanceof Error
            ? error.message
            : rt("log.autostartFailed", { name: service.name }),
        ),
        service,
      );
      await recordAutomationHistory({
        title: rt("history.autostartFailed", { name: service.name }),
        detail: error instanceof Error ? error.message : rt("lastExit.autostartFailed"),
        outcome: "error",
        source: "runtime",
        serviceId: service.id,
        serviceName: service.name,
      });
    }
  }

  for (const profile of profiles.filter((item) => item.enabled && item.action === "start")) {
    for (const serviceId of profile.serviceIds) {
      const service = services.find((item) => item.id === serviceId);
      if (service) {
        try {
          await startManagedService(service, "profile");
        } catch (error) {
          const serviceState = getManagedState(service.id);
          serviceState.starting = false;
          serviceState.lastExit = error instanceof Error ? error.message : rt("lastExit.profileBootFailed");
          appendManagedLogEntry(
            serviceState.logs,
            "stderr",
            createLogEntry(
              "error",
              error instanceof Error
                ? error.message
                : rt("history.profileStartFailed", { name: service.name }),
            ),
            service,
          );
          await recordAutomationHistory({
            title: rt("history.profileStartFailed", { name: service.name }),
            detail: error instanceof Error ? error.message : rt("lastExit.profileBootFailed"),
            outcome: "error",
            source: "profile",
            serviceId: service.id,
            serviceName: service.name,
          });
        }
      }
    }
  }
}

function buildAlerts(processes, ports, metrics, services, history) {
  const alerts = [];
  const conflictPorts = ports.filter((port) => port.status === "conflict");
  const publicPorts = ports.filter((port) => port.exposure === "public");
  const hotProcess = processes[0];
  const stoppedManaged = services.filter((service) => {
    const serviceState = getManagedState(service.id);
    return !isServiceRunning(serviceState);
  });
  const resourceSpikes = processes
    .filter(
      (process) =>
        process.managed &&
        process.status !== "stopped" &&
        (process.cpu >= 75 || process.memory >= 1200),
    )
    .slice(0, 2);
  const recentCrashLoops = services
    .map((service) => {
      const recentFailures = history.filter(
        (entry) =>
          entry.serviceId === service.id &&
          entry.outcome === "error" &&
          hoursSinceStamp(entry.stamp) <= 2,
      ).length;
      const recentPolicyRetries = history.filter(
        (entry) =>
          entry.serviceId === service.id &&
          entry.source === "policy" &&
          hoursSinceStamp(entry.stamp) <= 2,
      ).length;

      return {
        service,
        recentFailures,
        recentPolicyRetries,
      };
    })
    .filter((entry) => entry.recentFailures >= 2 || entry.recentPolicyRetries >= 3)
    .slice(0, 2);
  const orphanedReservedPorts = services
    .flatMap((service) =>
      service.ports.map((port) => ({
        service,
        port,
      })),
    )
    .filter(({ service, port }) => {
      const binding = ports.find((item) => item.port === port && item.status !== "standby");
      if (!binding) {
        return false;
      }

      return binding.serviceId !== service.id;
    })
    .slice(0, 2);

  if (conflictPorts.length > 0) {
    alerts.push(
      createAlert({
        id: "live-alert-conflicts",
        title: rt("alerts.portConflict.title"),
        detail: rt("alerts.portConflict.detail", { count: conflictPorts.length }),
        severity: "critical",
        category: "ports",
      }),
    );
  }

  if (publicPorts.length > 0) {
    alerts.push(
      createAlert({
        id: "live-alert-public",
        title: rt("alerts.publicExposed.title"),
        detail: rt("alerts.publicExposed.detail", { count: publicPorts.length }),
        severity: "warning",
        category: "ports",
      }),
    );
  }

  if (hotProcess && hotProcess.cpu >= 70) {
    alerts.push(
      createAlert({
        id: "live-alert-cpu",
        title: rt("alerts.hotProcess.title"),
        detail: rt("alerts.hotProcess.detail", { name: hotProcess.name, cpu: hotProcess.cpu }),
        severity: "warning",
        serviceId: hotProcess.id,
        serviceName: hotProcess.name,
        category: "resources",
      }),
    );
  }

  if (metrics.memory.value >= 80) {
    alerts.push(
      createAlert({
        id: "live-alert-memory",
        title: rt("alerts.memoryPressure.title"),
        detail: rt("alerts.memoryPressure.detail", { value: metrics.memory.value }),
        severity: "warning",
        category: "resources",
      }),
    );
  }

  if (metrics.gpu.available !== false && metrics.gpu.value >= 85) {
    alerts.push(
      createAlert({
        id: "live-alert-gpu",
        title: rt("alerts.gpuLoad.title"),
        detail: rt("alerts.gpuLoad.detail", {
          value: metrics.gpu.displayValue ?? `${metrics.gpu.value}%`,
        }),
        severity: "warning",
        category: "resources",
      }),
    );
  }

  if (stoppedManaged.length > 0) {
    alerts.push(
      createAlert({
        id: "live-alert-managed",
        title: rt("alerts.managedParked.title"),
        detail: rt("alerts.managedParked.detail", { name: stoppedManaged[0].name }),
        severity: "info",
        serviceId: stoppedManaged[0].id,
        serviceName: stoppedManaged[0].name,
        category: "runtime",
      }),
    );
  }

  for (const spike of resourceSpikes) {
    alerts.push(
      createAlert({
        id: `live-alert-spike-${spike.id}`,
        title: rt("alerts.managedHot.title"),
        detail:
          spike.cpu >= 75
            ? rt("alerts.managedHot.cpuDetail", { name: spike.name, cpu: spike.cpu })
            : rt("alerts.managedHot.memoryDetail", { name: spike.name, memory: spike.memory }),
        severity: spike.cpu >= 85 || spike.memory >= 1800 ? "critical" : "warning",
        serviceId: spike.id,
        serviceName: spike.name,
        category: "resources",
      }),
    );
  }

  for (const loop of recentCrashLoops) {
    alerts.push(
      createAlert({
        id: `live-alert-crash-loop-${loop.service.id}`,
        title: rt("alerts.crashLoop.title"),
        detail: rt("alerts.crashLoop.detail", {
          name: loop.service.name,
          failures: loop.recentFailures,
          retries: loop.recentPolicyRetries,
        }),
        severity: "critical",
        serviceId: loop.service.id,
        serviceName: loop.service.name,
        category: "automation",
      }),
    );
  }

  for (const orphaned of orphanedReservedPorts) {
    alerts.push(
      createAlert({
        id: `live-alert-orphaned-port-${orphaned.service.id}-${orphaned.port}`,
        title: rt("alerts.orphanedPort.title"),
        detail: rt("alerts.orphanedPort.detail", {
          name: orphaned.service.name,
          port: orphaned.port,
        }),
        severity: "critical",
        serviceId: orphaned.service.id,
        serviceName: orphaned.service.name,
        category: "ports",
      }),
    );
  }

  if (alerts.length === 0) {
    alerts.push(
      createAlert({
        id: "live-alert-quiet",
        title: rt("alerts.healthy.title"),
        detail: rt("alerts.healthy.detail"),
        severity: "info",
        category: "runtime",
      }),
    );
  }

  return alerts.slice(0, 6);
}

function resolveJobStatus(service, serviceState) {
  if (serviceState.lastRunExit === null || serviceState.lastRunExit === undefined) {
    return "stopped";
  }

  return serviceState.lastRunExit === 0 ? "completed" : "failed";
}

async function hydrateRuntimeSnapshot({ monitorWindow } = {}) {
  runtimeLogger.debug(rt("internal.hydrating"));
  await logBroker.ensureStarted();
  await initializeManagedServices();

  const [cpuPercent, networkUsage, diskPercent, gpuUsage, rawProcesses, rawBindings, config] =
    await Promise.all([
      sampleCpuUsage(),
      sampleNetworkUsage(),
      readDiskUsage(),
      sampleGpuUsage(),
      readUserProcesses(),
      readPortBindings(),
      loadManagedConfig(),
    ]);
  const { services, profiles, history } = config;
  seedJobStateFromConfig(services);

  await Promise.all(
    services
      .filter((service) => service.kind === "docker")
      .map((service) => collectManagedDockerLogs(service)),
  );

  const memoryPercent = clamp(
    Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    0,
    100,
  );

  const processByPid = new Map(rawProcesses.map((processRow) => [processRow.pid, processRow]));
  const portMap = new Map();
  for (const binding of rawBindings) {
    const list = portMap.get(binding.pid) ?? [];
    list.push(binding);
    portMap.set(binding.pid, list);
  }

  const processLookup = new Map();
  const managedPids = new Set();

  const managedProcesses = services.map((service) => {
    const { serviceState, adoptedProcess } = syncManagedServiceState(service, rawProcesses, portMap);
    const childPid = serviceState.child?.pid ?? serviceState.adoptedPid ?? null;
    const liveProcess = childPid ? processByPid.get(childPid) ?? adoptedProcess ?? null : null;
    const livePorts = childPid ? portMap.get(childPid) ?? [] : [];
    const reservedPorts = Array.from(new Set([...service.ports, ...livePorts.map((item) => item.port)]));
    const runtime = service.runtime || normalizeRuntime(service.startCommand, "");
    const stopCommand = getManagedStopCommand(service) || null;
    const status = serviceState.starting
      ? "starting"
      : liveProcess
        ? normalizeStatus(liveProcess.state)
        : service.lifecycle === "job"
          ? resolveJobStatus(service, serviceState)
          : "stopped";

    if (childPid) {
      managedPids.add(childPid);
    }

    const record = {
      id: service.id,
      name: service.name,
      group: localizeGroup(service.group),
      description: service.description,
      command: service.startCommand,
      cwd: resolveServiceCwd(service.cwd),
      runtime,
      kind: service.kind,
      lifecycle: service.lifecycle === "job" ? "job" : "service",
      startCommand: service.startCommand,
      stopCommand,
      restartCommand: service.restartCommand || null,
      status,
      pid: childPid,
      ports: reservedPorts,
      cpu: liveProcess ? clamp(liveProcess.cpu, 0, 100) : 0,
      memory: liveProcess ? liveProcess.memoryMb : 0,
      network: 0,
      uptime: liveProcess ? formatElapsed(liveProcess.elapsed) : formatManagedElapsed(serviceState.startedAt),
      restarts: serviceState.restartCount,
      lastExit: serviceState.lastExit,
      lastRunExit: service.lifecycle === "job" ? serviceState.lastRunExit ?? null : null,
      runCount: service.lifecycle === "job" ? serviceState.jobRunCount : 0,
      lastHeartbeat: liveProcess ? rt("heartbeat.live") : serviceState.lastHeartbeat,
      autoStart: service.autoStart,
      watchPorts: service.watchPorts,
      restartPolicy: service.restartPolicy,
      restartLimit: service.restartLimit,
      env: sanitizeServiceEnv(service.env),
      managed: true,
      titleColor: service.titleColor,
      icon: service.icon,
      review: localizeManagedReview(service.review),
      logs: serviceState.logs,
    };

    if (childPid) {
      processLookup.set(childPid, record);
    }

    return record;
  });

  const selectedPids = new Set([
    ...rawProcesses.slice(0, processLimit).map((processRow) => processRow.pid),
    ...rawBindings.map((binding) => binding.pid),
  ]);

  const discoveredProcesses = rawProcesses
    .filter(
      (processRow) =>
        selectedPids.has(processRow.pid) &&
        !managedPids.has(processRow.pid) &&
        !isHelperProcessRow(processRow),
    )
    .sort((left, right) => right.cpu + right.memoryMb / 25 - (left.cpu + left.memoryMb / 25))
    .map((processRow) => {
      const runtime = normalizeRuntime(processRow.command, processRow.args);
      const group = localizeGroup(normalizeGroup(runtime, processRow.cwd));
      const processPorts = (portMap.get(processRow.pid) ?? []).map((binding) => binding.port);
      const status = normalizeStatus(processRow.state);
      const processRecord = {
        id: `pid-${processRow.pid}`,
        name: path.basename(processRow.command),
        group,
        description: processRow.cwd
          ? rt("processes.description.discoveredCwd", { runtime, cwd: processRow.cwd })
          : rt("processes.description.discovered", { runtime }),
        command: processRow.args,
        cwd: processRow.cwd || rt("uptime.unknown"),
        runtime,
        kind: normalizeManagedServiceKind(runtime === "docker" ? "docker" : "command", processRow.args),
        status,
        pid: processRow.pid,
        ports: processPorts,
        cpu: clamp(processRow.cpu, 0, 100),
        memory: processRow.memoryMb,
        network: 0,
        uptime: formatElapsed(processRow.elapsed),
        restarts: 0,
        lastExit: rt("processes.lastExitDiscovered"),
        lastHeartbeat: rt("heartbeat.live"),
        autoStart: false,
        watchPorts: processPorts.length > 0,
        restartPolicy: "manual",
        restartLimit: defaultRestartLimit,
        managed: false,
        logs: {
          stdout: [
            createLogEntry(
              "info",
              rt("log.discovered", { args: processRow.args }),
            ),
          ],
          stderr:
            status === "degraded"
              ? [createLogEntry("warning", rt("log.degradedKernel"))]
              : [],
        },
      };

      processLookup.set(processRow.pid, processRecord);
      return processRecord;
    });

  const portGroups = new Map();
  for (const binding of rawBindings) {
    const key = `${binding.protocol}:${binding.port}`;
    const list = portGroups.get(key) ?? [];
    list.push(binding.pid);
    portGroups.set(key, list);
  }

  const ports = rawBindings
    .filter((binding) => processLookup.has(binding.pid))
    .map((binding) => {
      const owningProcess = processLookup.get(binding.pid);
      const status =
        (portGroups.get(`${binding.protocol}:${binding.port}`) ?? []).length > 1
          ? "conflict"
          : "bound";
      const exposure = inferExposure(binding.target);

      return {
        id: `port-${binding.protocol}-${binding.port}-pid-${binding.pid}`,
        port: binding.port,
        protocol: binding.protocol,
        serviceId: owningProcess.id,
        service: owningProcess.name,
        target: binding.target,
        exposure,
        status,
        history: getRecentPortHistory(binding.port, binding.protocol),
        note:
          status === "conflict"
            ? rt("ports.note.conflict")
            : exposure === "public"
              ? rt("ports.note.public")
              : rt("ports.note.discovered"),
      };
    })
    .sort((left, right) => left.port - right.port);

  const metrics = {
    cpu: {
      id: "cpu",
      label: rt("metrics.cpu.label"),
      value: cpuPercent,
      detail: rt("metrics.cpu.detail"),
    },
    memory: {
      id: "memory",
      label: rt("metrics.memory.label"),
      value: memoryPercent,
      detail: rt("metrics.memory.detail", {
        used: Math.floor((os.totalmem() - os.freemem()) / oneMegabyte),
        total: Math.floor(os.totalmem() / oneMegabyte),
      }),
    },
    disk: {
      id: "disk",
      label: rt("metrics.disk.label"),
      value: diskPercent,
      detail: rt("metrics.disk.detail"),
    },
    network: {
      id: "network",
      label: rt("metrics.network.label"),
      value: networkUsage.percent,
      detail: rt("metrics.network.detail", {
        throughput: formatThroughput(networkUsage.bytesPerSecond),
      }),
    },
    gpu: {
      id: "gpu",
      label: rt("metrics.gpu.label"),
      value: gpuUsage.percent,
      detail: gpuUsage.detail,
      displayValue: gpuUsage.available ? `${gpuUsage.percent}%` : rt("metrics.gpu.unavailable"),
      available: gpuUsage.available,
    },
  };

  const monitorHistory = buildWindowedMonitorHistory(metrics, monitorWindow);

  const alerts = buildAlerts(
    [...managedProcesses, ...discoveredProcesses],
    ports,
    metrics,
    services,
    history,
  );
  rememberManagedInspectorLogs(managedProcesses);
  rememberAlertEvents(alerts);

  for (const entry of history) {
    rememberUnifiedLogEvent({
      id: `automation-${entry.id}`,
      timestamp: entry.stamp,
      level:
        entry.outcome === "error"
          ? "error"
          : entry.outcome === "warning"
            ? "warn"
            : "success",
      source: entry.source,
      sourceLabel: entry.serviceName || entry.source,
      category: "automation",
      message: `${entry.title}: ${entry.detail}`,
      serviceId: entry.serviceId,
      serviceName: entry.serviceName,
    });
  }

  return {
    processes: [...managedProcesses, ...discoveredProcesses],
    ports,
    alerts,
    monitorMetrics: [metrics.cpu, metrics.memory, metrics.disk, metrics.network, metrics.gpu],
    monitorHistory,
    automationRules: buildAutomationRules(services, profiles),
    automationHistory: history,
    logs: getUnifiedLogSnapshot(),
  };
}

async function performProcessAction(action, processId) {
  await initializeManagedServices();
  processManagerLogger.info(rt("internal.performingAction"), { action, processId });

  if (action === "scan") {
    runtimeLogger.debug(rt("internal.onDemandScan"));
    return {
      snapshot: await hydrateRuntimeSnapshot(),
      message: rt("messages.scanCompleted"),
    };
  }

  if (action === "kill") {
    processManagerLogger.warn(rt("internal.killRequested"), { processId });
    return killObservedProcess(processId);
  }

  const { services } = await loadManagedConfig();
  const service = services.find((item) => item.id === processId);

  if (!service) {
    throw new Error(rt("errors.serviceNotConfigured"));
  }

  let message;
  if (action === "start") {
    message = await startManagedService(service);
  } else if (action === "stop") {
    message = await stopManagedService(service);
  } else if (action === "restart") {
    message = await restartManagedService(service);
  } else {
    throw new Error(rt("errors.unsupportedAction", { action }));
  }

  return {
    snapshot: await hydrateRuntimeSnapshot(),
    message,
  };
}

async function updateManagedService(processId, updates) {
  processManagerLogger.info(rt("internal.updatingService"), { processId });
  const config = await loadManagedConfig();
  const serviceIndex = config.services.findIndex((service) => service.id === processId);

  if (serviceIndex === -1) {
    throw new Error(rt("errors.serviceNotEditable"));
  }

  const previousService = config.services[serviceIndex];
  const startCommand =
    typeof updates.startCommand === "string"
      ? updates.startCommand.trim()
      : previousService.startCommand;

  if (!startCommand) {
    throw new Error(rt("errors.startCommandRequired"));
  }

  const nextService = {
    ...previousService,
    name:
      typeof updates.name === "string" && updates.name.trim().length > 0
        ? updates.name.trim()
        : previousService.name,
    description:
      typeof updates.description === "string"
        ? updates.description.trim()
        : previousService.description,
    kind: normalizeManagedServiceKind(updates.kind, startCommand),
    lifecycle:
      updates.lifecycle === "job" || updates.lifecycle === "service"
        ? updates.lifecycle
        : previousService.lifecycle === "job"
          ? "job"
          : "service",
    startCommand,
    stopCommand:
      typeof updates.stopCommand === "string"
        ? updates.stopCommand.trim()
        : previousService.stopCommand,
    restartCommand:
      typeof updates.restartCommand === "string"
        ? updates.restartCommand.trim()
        : previousService.restartCommand,
    cwd:
      typeof updates.cwd === "string" && updates.cwd.trim().length > 0
        ? updates.cwd.trim()
        : previousService.cwd,
    autoStart:
      typeof updates.autoStart === "boolean"
        ? updates.autoStart
        : previousService.autoStart,
    watchPorts:
      typeof updates.watchPorts === "boolean"
        ? updates.watchPorts
        : previousService.watchPorts,
    restartPolicy:
      (updates.lifecycle === "job" ? "manual" : undefined) ??
      (typeof updates.restartPolicy === "string"
        ? normalizeRestartPolicy(updates.restartPolicy)
        : previousService.lifecycle === "job"
          ? "manual"
          : previousService.restartPolicy),
    restartLimit:
      typeof updates.restartLimit === "number"
        ? normalizeRestartLimit(updates.restartLimit)
        : previousService.restartLimit,
    env:
      updates.env && typeof updates.env === "object" && !Array.isArray(updates.env)
        ? sanitizeServiceEnv(updates.env)
        : previousService.env,
    titleColor:
      typeof updates.titleColor === "string" ? updates.titleColor : previousService.titleColor,
    icon: typeof updates.icon === "string" ? updates.icon : previousService.icon,
  };
  if (updates.clearReview === true) {
    delete nextService.review;
  }

  config.services[serviceIndex] = nextService;
  await saveManagedConfig(config);

  return {
    snapshot: await hydrateRuntimeSnapshot(),
    message:
      updates.clearReview === true
        ? rt("messages.reviewCleared", { name: nextService.name })
        : rt("messages.settingsUpdated", { name: nextService.name }),
  };
}

async function createManagedService(service) {
  processManagerLogger.info(rt("internal.creatingDraft"), {
    name: typeof service?.name === "string" ? service.name : "unknown",
  });
  const config = await loadManagedConfig();
  const name = typeof service.name === "string" ? service.name.trim() : "";
  const startCommand =
    typeof service.startCommand === "string" ? service.startCommand.trim() : "";

  if (!name || !startCommand) {
    throw new Error(rt("errors.nameAndStartRequired"));
  }

  const cwd =
    typeof service.cwd === "string" && service.cwd.trim().length > 0
      ? service.cwd.trim()
      : ".";
  const runtime = normalizeRuntime(startCommand, "");
  const nextService = {
    id: createManagedServiceId(name, config.services),
    name,
    description:
      typeof service.description === "string" && service.description.trim().length > 0
        ? service.description.trim()
        : rt("default.description"),
    kind: normalizeManagedServiceKind(service.kind, startCommand),
    lifecycle: service.lifecycle === "job" ? "job" : "service",
    startCommand,
    stopCommand:
      typeof service.stopCommand === "string" ? service.stopCommand.trim() : "",
    restartCommand:
      typeof service.restartCommand === "string" ? service.restartCommand.trim() : "",
    cwd,
    runtime,
    group: normalizeGroup(runtime, cwd),
    watchPorts: service.watchPorts !== false,
    autoStart: service.autoStart === true,
    restartPolicy:
      service.lifecycle === "job" ? "manual" : normalizeRestartPolicy(service.restartPolicy),
    restartLimit: normalizeRestartLimit(service.restartLimit),
    ports: [],
    inheritEnv: [...defaultInheritedEnvKeys],
    env: sanitizeServiceEnv(service.env),
    titleColor: typeof service.titleColor === "string" ? service.titleColor : "default",
    icon: typeof service.icon === "string" ? service.icon : "server",
  };

  const existingService = config.services.find(
    (entry) => getManagedServiceDedupKey(entry) === getManagedServiceDedupKey(nextService),
  );

  if (existingService) {
    return {
      snapshot: await hydrateRuntimeSnapshot(),
      message: rt("messages.alreadyManaged", { name: existingService.name }),
    };
  }

  config.services.push(nextService);
  await saveManagedConfig(config);

  return {
    snapshot: await hydrateRuntimeSnapshot(),
    message: rt("messages.nowManaged", { name: nextService.name }),
  };
}

async function removeManagedService(processId) {
  processManagerLogger.warn(rt("internal.removingService"), { processId });
  const config = await loadManagedConfig();
  const serviceIndex = config.services.findIndex((service) => service.id === processId);
  if (serviceIndex === -1) {
    return {
      snapshot: await hydrateRuntimeSnapshot(),
      message: rt("messages.alreadyRemoved"),
    };
  }

  const removedService = config.services[serviceIndex];
  config.services.splice(serviceIndex, 1);
  config.profiles = config.profiles
    .map((profile) => ({
      ...profile,
      serviceIds: profile.serviceIds.filter((serviceId) => serviceId !== processId),
    }))
    .filter((profile) => profile.serviceIds.length > 0);
  await saveManagedConfig(config);
  managedServiceState.delete(processId);

  return {
    snapshot: await hydrateRuntimeSnapshot(),
    message: rt("messages.nowObservedOnly", { name: removedService.name }),
  };
}

async function applyAutomationRule(ruleId, enabled) {
  automationLogger.info(rt("internal.applyingRule"), { ruleId, enabled });
  const config = await loadManagedConfig();

  if (ruleId.startsWith("service-autostart:")) {
    const processId = ruleId.replace("service-autostart:", "");
    const config = await loadManagedConfig();
    const service = config.services.find((item) => item.id === processId);
    const result = await updateManagedService(processId, { autoStart: enabled });
    if (service) {
      await recordAutomationHistory({
        title: rt(enabled ? "history.autostartEnabled" : "history.autostartDisabled", {
          name: service.name,
        }),
        detail: rt(
          enabled ? "history.autostartEnabledDetail" : "history.autostartDisabledDetail",
        ),
        outcome: "success",
        source: "manual",
        serviceId: service.id,
        serviceName: service.name,
      });
    }
    return result;
  }

  if (ruleId.startsWith("service-watch:")) {
    const processId = ruleId.replace("service-watch:", "");
    const config = await loadManagedConfig();
    const service = config.services.find((item) => item.id === processId);
    const result = await updateManagedService(processId, { watchPorts: enabled });
    if (service) {
      await recordAutomationHistory({
        title: rt(enabled ? "history.watchEnabled" : "history.watchDisabled", {
          name: service.name,
        }),
        detail: rt(enabled ? "history.watchEnabledDetail" : "history.watchDisabledDetail"),
        outcome: "success",
        source: "manual",
        serviceId: service.id,
        serviceName: service.name,
      });
    }
    return result;
  }

  if (ruleId.startsWith("profile:")) {
    const profileId = ruleId.replace("profile:", "");
    const profileIndex = config.profiles.findIndex((profile) => profile.id === profileId);

    if (profileIndex === -1) {
      throw new Error(rt("errors.profileNotFound"));
    }

    const profile = { ...config.profiles[profileIndex], enabled };
    config.profiles[profileIndex] = profile;
    await saveManagedConfig(config);

    for (const serviceId of profile.serviceIds) {
      const service = config.services.find((item) => item.id === serviceId);
      if (!service) {
        continue;
      }

      if (profile.action === "start" && enabled) {
        await startManagedService(service, "profile");
      }

      if (profile.action === "stop" && enabled) {
        await stopManagedService(service, "profile");
      }
    }

    await recordAutomationHistory({
      title: rt(enabled ? "history.profileEnabled" : "history.profileDisabled", {
        title: profile.title,
      }),
      detail: rt(enabled ? "history.profileEnabledDetail" : "history.profileDisabledDetail"),
      outcome: "success",
      source: "profile",
    });

    return {
      snapshot: await hydrateRuntimeSnapshot(),
      message: rt(enabled ? "messages.profileEnabled" : "messages.profileDisabled", {
        title: profile.title,
      }),
    };
  }

  throw new Error(rt("errors.ruleNotManaged"));
}

async function shutdownManagedServices() {
  const { services } = await loadManagedConfig();

  for (const service of services) {
    const serviceState = getManagedState(service.id);
    if (isServiceRunning(serviceState)) {
      await stopManagedService(service, "runtime");
    }
  }

  await logBroker.stop();
  await stopHistoryTimers();
  await logFileSink.stopLogFilePersistence();
}

module.exports = {
  hydrateRuntimeSnapshot,
  performProcessAction,
  setRuntimeLogBatchListener,
  setRuntimeLocale,
  onRuntimeLocaleChanged,
  rt,
  updateManagedService,
  createManagedService,
  removeManagedService,
  applyAutomationRule,
  shutdownManagedServices,
};
