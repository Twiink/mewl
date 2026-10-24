// English catalog. This file is the source of truth for translation keys:
// the zh.ts dictionary is type-checked against keyof typeof en, so a key that
// exists here but is missing there fails the build.
// 英文词典。本文件是翻译键的唯一权威来源：zh.ts 会以 keyof typeof en 做类型校验，
// 缺失的键会直接导致编译失败。
//
// Interpolation conventions shared by every dictionary:
//   {name}     -> replaced by params.name
//   {|s}       -> "" when params.count === 1, otherwise "s"
//   {|y,ies}   -> "y" when params.count === 1, otherwise "ies"
// 所有词典共用的插值约定：
//   {name}     -> 替换为 params.name
//   {|s}       -> params.count === 1 时输出 ""，否则输出 "s"
//   {|y,ies}   -> params.count === 1 时输出 "y"，否则输出 "ies"
export const en = {
  // Language switcher / 语言切换
  "language.switch": "Switch language",

  // Document chrome (index.html shell) / 文档外壳（index.html）
  "app.metaDescription":
    "Mewl is a local operations dashboard for services, ports, and host telemetry.",
  "shell.appIconAlt": "Mewl icon",

  // Sidebar navigation / 侧边栏导航
  "nav.overview": "Overview",
  "nav.processes": "Processes",
  "nav.managed": "Managed",
  "nav.logs": "Logs",
  "nav.ports": "Ports",
  "nav.monitor": "Monitor",

  // Shared status + filter vocabulary / 通用状态与筛选词汇
  "filters.all": "All",
  "filters.active": "Active",
  "filters.watching": "Watching",
  "filters.issues": "Issues",

  "status.online": "Online",
  "status.warning": "Warning",
  "status.offline": "Offline",
  "status.starting": "Starting",
  "status.running": "Running",
  "status.degraded": "Degraded",
  "status.stopped": "Stopped",

  "port.status.bound": "Bound",
  "port.status.booting": "Booting",
  "port.status.standby": "Standby",
  "port.status.conflict": "Conflict",

  "exposure.public": "Public",
  "exposure.local": "Local",
  "exposure.internal": "Internal",

  "severity.critical": "Critical",
  "severity.warning": "Warning",
  "severity.info": "Info",

  "level.error": "Error",
  "level.warn": "Warn",
  "level.warning": "Warning",
  "level.info": "Info",
  "level.success": "Success",
  "level.debug": "Debug",
  "level.fatal": "Fatal",
  "level.log": "Log",
  "level.trace": "Trace",

  // Uptime / heartbeat vocabulary mirrored from the Electron bridge / 与 Electron 桥接对齐的运行时长与心跳词汇
  "uptime.unknown": "unknown",
  "uptime.stopped": "stopped",
  "uptime.justNow": "just now",
  "heartbeat.live": "live",
  "heartbeat.idle": "idle",
  "heartbeat.booting": "booting",

  // Lifecycle actions / 生命周期操作
  "action.start": "Start",
  "action.stop": "Stop",
  "action.restart": "Restart",
  "verb.start": "Starting",
  "verb.stop": "Stopping",
  "verb.restart": "Restarting",

  // Managed service editor vocabulary / 托管服务编辑器词汇
  "kind.command": "Command",
  "kind.script": "Script",
  "kind.docker": "Docker",
  "kind.command.detail":
    "Use for standard binaries, package scripts, workers, and local daemons.",
  "kind.script.detail": "Use for exact launch and teardown scripts, including direct file paths.",
  "kind.docker.detail":
    "Use for Docker Compose or docker run flows with container-oriented stop behavior.",
  "kind.command.startLabel": "Start Command",
  "kind.command.stopLabel": "Stop Command",
  "kind.command.restartLabel": "Restart Command",
  "kind.command.startPlaceholder": "npm run dev",
  "kind.command.stopPlaceholder": "Optional. Leave blank to stop by tracked pid.",
  "kind.command.restartPlaceholder": "Optional. Leave blank for stop/start.",
  "kind.command.guidance":
    "Best for package scripts, local binaries, background workers, and long-running dev servers.",
  "kind.script.startLabel": "Launch Script",
  "kind.script.stopLabel": "Teardown Script",
  "kind.script.restartLabel": "Restart Script",
  "kind.script.startPlaceholder": "./scripts/dev.sh --watch",
  "kind.script.stopPlaceholder": "Optional. Example: ./scripts/stop-dev.sh",
  "kind.script.restartPlaceholder": "Optional. Example: ./scripts/restart-dev.sh",
  "kind.script.guidance":
    "Direct script paths are now first-class. Mewl resolves common script extensions without requiring shell chaining.",
  "kind.docker.startLabel": "Docker Start Flow",
  "kind.docker.stopLabel": "Docker Stop Flow",
  "kind.docker.restartLabel": "Docker Restart Flow",
  "kind.docker.startPlaceholder": "docker compose up api",
  "kind.docker.stopPlaceholder": "Optional. Example: docker compose stop api",
  "kind.docker.restartPlaceholder": "Optional. Example: docker compose restart api",
  "kind.docker.guidance":
    "Use explicit Docker commands when you have them. If stop is blank, Mewl can derive a safe Docker stop flow for common compose and named-container launches.",

  "color.white": "White",
  "color.rose": "Rose",
  "color.purple": "Purple",
  "color.cyan": "Cyan",
  "color.green": "Green",
  "color.amber": "Amber",

  "icon.server": "Server",
  "icon.terminal": "Terminal",
  "icon.globe": "Globe",
  "icon.database": "Database",
  "icon.bot": "Bot",
  "icon.workflow": "Workflow",
  "icon.sparkles": "Sparkles",

  // Tags rendered on process rows / 进程行上的标签
  "tag.managed": "managed",
  "tag.observed": "observed",
  "tag.needsCleanup": "needs cleanup",

  // Field labels reused across pages / 跨页面复用的字段标签
  "field.runtime": "Runtime",
  "field.uptime": "Uptime",
  "field.restarts": "Restarts",
  "field.lastPulse": "Last Pulse",
  "field.lastExit": "Last Exit",
  "field.launchCommand": "Launch Command",
  "field.command": "Command",
  "field.ports": "Ports",
  "field.pid": "PID",
  "field.cpu": "CPU",
  "field.memory": "Memory",
  "field.network": "Network",
  "field.proto": "Proto",
  "field.exposure": "Exposure",
  "field.target": "Target",
  "field.none": "none",
  "field.idle": "idle",

  // Overview page / 总览页
  "overview.services": "Services",
  "overview.servicesDetail": "{count} need attention",
  "overview.openPorts": "Open Ports",
  "overview.publicBindings": "{count} public bindings",
  "overview.watchers": "Watchers",
  "overview.autostartEnabled": "{count} autostart enabled",
  "overview.processes": "Processes",
  "overview.runningNow": "Running Now",
  "overview.shownCount": "{count} shown",
  "overview.seeAll": "See all",
  "overview.bindings": "Bindings",
  "overview.portWatch": "Port Watch",
  "overview.noProcesses": "No processes match the current workspace filters yet.",
  "overview.noBindings": "No watched bindings match the current search right now.",
  "overview.systemMonitor": "System Monitor",
  "overview.basics": "Basics",
  "overview.openMonitor": "Open monitor",

  // Alerts feed / 告警面板
  "alerts.allServices": "All Services",
  "alerts.window.allTime": "All Time",
  "alerts.empty.title": "No fresh alerts",
  "alerts.empty.detail":
    "The current alert filters do not match any items in the latest runtime feed.",

  // Inspector / 检查器
  "inspector.eyebrow": "Inspector",
  "inspector.noPorts": "no ports reserved",
  "inspector.observedOnly.title": "Observed Only",
  "inspector.observedOnly.detail":
    "This row reflects a live host process. Creating a managed draft will prefill the editor from what Mewl can observe right now, while kill will terminate the current pid without changing the managed catalog.",
  "inspector.cpuPressure": "CPU Pressure",
  "inspector.memoryFootprint": "Memory Footprint",
  "inspector.networkLoad": "Network Load",
  "inspector.recentOutput": "Recent output",
  "inspector.recentIssues": "Recent issues",
  "inspector.noStdout": "No stdout lines have been recorded for this process yet.",
  "inspector.noStderr": "No stderr lines are waiting right now.",
  "action.createManagedDraft": "Create Managed Draft",
  "action.killObservedPid": "Kill Observed PID",

  // Processes page / 进程页
  "processes.expand": "Expand",
  "processes.collapse": "Collapse",
  "processes.observedActions.title": "Observed Runtime Actions",
  "processes.observedActions.detail":
    "Promote this live row into a reviewed managed draft, or terminate only the current observed pid.",
  "processes.empty.title": "No live processes match this filter",
  "processes.empty.queryDetail":
    'The current query "{query}" and process filter do not match any live process.',
  "processes.empty.snapshotDetail":
    "No live processes are available from the current runtime snapshot.",
  "processes.resetFilters": "Reset Filters",

  // Managed page / 托管服务页
  "managed.eyebrow": "Managed Services",
  "managed.title": "Command Deck",
  "action.newService": "New Service",
  "managed.stat.managed": "Managed",
  "managed.stat.autostart": "Autostart",
  "managed.stat.guarded": "Guarded",
  "managed.stat.cleanup": "Cleanup",
  "managed.cleanup.title": "Legacy Config Cleanup",
  "managed.cleanup.detail": "{count} managed service{|s} still need a quick review.",
  "managed.showAll": "Show All",
  "managed.showCleanupOnly": "Show Cleanup Only",
  "managed.reviewFirst": "Review First",
  "managed.noDescription": "No description yet.",
  "managed.cleanupNotes": "Cleanup Notes",
  "managed.cleanupFallback":
    "This service was normalized from an older config entry and should be confirmed.",
  "managed.field.pulse": "Pulse",
  "managed.field.restart": "Restart",
  "managed.restartPolicyValue": "{policy} / {limit}x",
  "managed.autostart.detail": "Launch this service automatically when the desktop runtime boots.",
  "managed.watchPorts.label": "Watch Ports",
  "managed.watchPorts.detail":
    "Include this service in watched binding scans so Mewl can flag port collisions or drift.",
  "managed.on": "On",
  "managed.off": "Off",
  "action.confirmCleanupReview": "Confirm cleanup review",
  "action.editService": "Edit service",
  "managed.empty.cleanupOnly":
    "No managed services still need cleanup review right now. Switch back to the full command deck to see every saved service.",
  "managed.empty.create":
    "Create your first managed service to give Mewl a real launch definition instead of relying on a discovered process snapshot.",

  // Logs page / 日志页
  "logs.title": "Unified Diagnostics",
  "action.pause": "Pause",
  "action.resume": "Resume",
  "logs.followTail": "Follow Tail",
  "action.clear": "Clear",
  "action.export": "Export",
  "logs.tab.all": "All",
  "logs.tab.mewl": "Mewl",
  "logs.tab.processes": "Processes",
  "logs.tab.containers": "Containers",
  "logs.tab.system": "System",
  "logs.searchPlaceholder": "Search messages, sources, categories, or services...",
  "logs.allSources": "All Sources",
  "logs.stat.captured": "Captured",
  "logs.stat.visible": "Visible",
  "logs.stat.buffered": "Buffered",
  "logs.stat.sources": "Sources",
  "logs.mode.paused": "ui paused",
  "logs.mode.live": "live tail",
  "logs.mode.manual": "manual browse",
  "logs.empty": "No log events match the current diagnostics filters yet.",
  "logs.exported": "Exported {count} visible log events.",
  "logs.cleared": "Cleared the local Logs workspace history.",

  // Managed editor modal / 托管服务编辑弹窗
  "editor.title.create": "Create Managed Service",
  "editor.title.createFromObserved": "Create Managed Service From Observed Runtime",
  "editor.title.edit": "Edit Managed Service",
  "editor.heading.create": "Author a launch definition",
  "editor.heading.createFromObserved": "Review the observed draft",
  "editor.heading.fallback": "Managed editor",
  "action.removeManagedService": "Remove managed service",
  "editor.closeAria": "Close managed editor",
  "editor.prefill.title": "Prefilled From Observed Runtime",
  "editor.prefill.detail":
    "This draft was captured from the live process {name} (pid {pid}). Review the command and optional stop or restart hooks before saving it as a managed definition.",
  "editor.prefill.commandLabel": "Observed Command",
  "editor.cleanup.title": "Cleanup This Imported Service",
  "editor.cleanup.detail":
    "This saved definition was normalized from an older `mewl.services.json` entry. Confirm the details below once they look right.",
  "action.markReviewed": "Mark Reviewed",
  "editor.serviceMode": "Service Mode",
  "editor.name": "Name",
  "editor.namePlaceholder": "MyApp",
  "editor.description": "Description",
  "editor.descriptionPlaceholder": "Optional note for what this service does.",
  "editor.workingDirectory": "Working Directory",
  "editor.modeGuidance": "Mode Guidance",
  "editor.restartPolicy": "Restart Policy",
  "policy.manual": "Manual",
  "policy.manual.detail": "Only restart this service when you explicitly ask Mewl to do it.",
  "policy.on-failure": "On Failure",
  "policy.on-failure.detail":
    "Retry after non-zero exits or signals, up to the retry limit below.",
  "policy.always": "Always",
  "policy.always.detail":
    "Bring the service back after every exit until the retry limit is reached.",
  "editor.retryLimit": "Retry Limit",
  "editor.titleColor": "Title Color",
  "editor.cardIcon": "Card Icon",
  "editor.hint":
    "Commands are tokenized without a shell. Plain commands like `npm start`, `docker compose up app`, and direct script paths like `./scripts/dev.sh` work well here.",
  "action.createService": "Create Service",
  "action.saveChanges": "Save Changes",
  "action.reset": "Reset",
  "action.close": "Close",

  // Ports page / 端口页
  "ports.eyebrow": "Port Registry",
  "ports.table.port": "Port",
  "ports.table.service": "Service",
  "ports.table.status": "Status",
  "ports.empty.title": "No bindings match the current search",
  "ports.empty.detail":
    "Clear the current query or scan again once a runtime bridge is feeding fresh bindings.",
  "ports.safety.eyebrow": "Port Safety",
  "ports.safety.title": "Exposure Summary",
  "ports.safety.public": "Public",
  "ports.safety.conflicts": "Conflicts",
  "ports.safety.watched": "Watched",
  "ports.safety.open": "Open",
  "ports.safety.empty": "No public or conflicting bindings need attention right now.",

  // Monitor page / 监控页
  "monitor.gpuUnavailable": "Unavailable",
  "monitor.title": "Pressure Tides",
  "monitor.trendCanvas": "Trend Canvas",
  "monitor.rollingPressure": "Rolling host pressure",
  "monitor.runtimePulse": "Runtime Pulse",
  "monitor.currentWaveform": "Current service waveform",
  "monitor.live": "live",
  "monitor.waveformDetail":
    "Live waveform for the active service draw rhythm across the current sample window.",
  "monitor.trendEmpty":
    "Host metrics will appear here once the runtime source delivers a pressure snapshot.",
  "monitor.snapshotLane": "Snapshot Lane",
  "monitor.currentPressure": "Current host pressure",
  "monitor.last24": "last 24 samples",
  "monitor.waitingSnapshot": "Waiting on the next host pressure snapshot.",
  "monitor.noisyServices": "Noisy Services",
  "monitor.topDraw": "Top Resource Draw",
  "monitor.inspect": "Inspect",
  "monitor.leadersEmpty":
    "Resource leaders will appear after the runtime delivers process telemetry.",

  // Command strip / shell chrome / 顶部命令栏与外壳
  "shell.searchPlaceholder": "Search services, ports, folders, or commands...",
  "action.scan": "Scan",
  "shell.status.sourceError": "source error",
  "shell.status.hydrating": "hydrating",
  "shell.hostHealth": "Host Health",
  "shell.watched": "Watched",

  // Runtime source descriptors (mirrored from src/runtime/provider.ts) / 运行时来源描述（与 src/runtime/provider.ts 对齐）
  "runtime.electron.label": "Electron bridge",
  "runtime.electron.detail":
    "The renderer is connected to the Electron preload bridge and is reading live host state.",
  "runtime.desktopRequired.label": "Desktop bridge required",
  "runtime.desktopRequired.badge": "desktop required",
  "runtime.desktopRequired.detail":
    "Mewl now requires the Electron desktop bridge and does not expose a browser-only runtime fallback.",

  // State panels / 状态面板
  "state.loading.eyebrow": "Runtime Source",
  "state.loading.title": "Hydrating the local workspace",
  "state.loading.detail":
    "Mewl is restoring saved filters, process state, and the current {source} snapshot before the dashboard becomes interactive.",
  "state.error.title": "Workspace session could not be restored",
  "state.error.detail":
    "The desktop bridge could not be reached. Resetting the workspace will retry the live Electron connection.",
  "action.resetSession": "Reset Session",

  // Error fallbacks / 错误兜底文案
  "error.restoreFailed": "Mewl could not restore the workspace session.",
  "error.reconnectFailed": "Mewl could not reconnect to the Electron desktop bridge.",
  "error.bridgeRequired":
    "Mewl requires the Electron desktop bridge. Launch the app with npm run dev:desktop or npm run desktop.",
  "error.incompatibleWorkspace": "Saved workspace data is from an incompatible version.",
  "error.generic": "An unexpected error occurred.",

  // Command strip status messages (renderer side) / 命令栏状态消息（渲染进程侧）
  "command.ready": "Ready to manage local services, ports, and runtime pressure.",
  "command.bridgeMissingActions": "The Electron bridge is missing its lifecycle action handler.",
  "command.killChooseFirst": "Choose an observed process before requesting a live kill action.",
  "command.killManagedRejected":
    "Kill is reserved for observed live processes. Use the managed service controls for saved services.",
  "command.killNoPid": "That observed process no longer has a live pid to terminate.",
  "command.killDispatch": "Terminating observed process {name} (pid {pid}) from the Electron bridge.",
  "command.killFailed": "The Electron bridge could not terminate that observed process.",
  "command.onlyManaged":
    "Only services registered in mewl.services.json can be started, stopped, or restarted.",
  "command.scanDispatch": "Refreshing live host services, bindings, and telemetry from Electron.",
  "command.actionDispatch": "{verb} {name} from the Electron bridge.",
  "command.fallbackServiceName": "service",
  "command.actionFailed": "The Electron bridge could not complete that action.",
  "command.scanLocal": "Scanning watched bindings and reserved ranges.",
  "command.scanRequested": "Port scan requested from the command strip.",
  "command.scanStillConflicts": "Watch scan still sees {count} binding issue{|s} in the reserved range.",
  "command.scanClean": "Watch scan cleared the reserved bindings with no new collisions.",
  "command.scanAlert.drift.title": "Port scan found drift",
  "command.scanAlert.complete.title": "Port scan complete",
  "command.scanAlert.drift.detail": "{count} binding needs attention before the next restart.",
  "command.scanAlert.clean.detail": "No collisions were found in the reserved local range.",
  "command.scanDoneConflicts": "Port scan finished with collisions to resolve.",
  "command.scanDoneClean": "Port scan finished cleanly.",
  "command.killDesktopOnly":
    "Observed process termination is only available from the Electron desktop bridge.",
  "command.alreadyLive": "{name} is already live.",
  "command.noLaunchNeeded.title": "No launch needed",
  "command.noLaunchNeeded.detail": "{name} was already running when the launch command was issued.",
  "command.alreadyStopped": "{name} is already stopped.",
  "command.bootAccepted": "Boot request accepted by the managed runtime bridge.",
  "command.stopQueued": "Graceful shutdown request queued from the command strip.",
  "command.restartQueued": "Restart request queued and the process is entering the drain window.",
  "command.starting": "Starting {name}...",
  "command.stopping": "Stopping {name}...",
  "command.restarting": "Restarting {name}...",
  "command.bootCompleted": "Process boot completed and pid {pid} is now being tracked.",
  "command.drainComplete": "Process drained successfully and watched bindings were parked.",
  "command.restartCompleted": "Restart finished and pid {pid} is now serving traffic.",
  "command.bindingConflicts": "Binding watch still reports {count} conflict{|s} after the lifecycle action.",
  "command.launchAlert.title": "{name} launched",
  "command.stopAlert.title": "{name} stopped",
  "command.restartAlert.title": "{name} restarted",
  "command.launchAlert.detail": "Service boot completed and watched ports were rebound.",
  "command.stopAlert.detail": "Ports were parked and the process was taken out of rotation.",
  "command.stopAlert.lastExit": "Stopped from Mewl",
  "command.restartAlert.detail": "Lifecycle action completed and bindings were restored.",
  "command.restartAlert.lastExit": "Graceful restart triggered from Mewl",
  "command.resultRunning": "{name} is running.",
  "command.resultStopped": "{name} is stopped.",
  "command.resultRestarted": "{name} restart completed.",

  // Managed draft flow (renderer side) / 托管草稿流程（渲染进程侧）
  "command.alreadyManaged":
    "That process is already managed. Open it from the Managed workspace to edit the saved definition.",
  "command.prefilledDraft":
    "Prefilled a managed draft from observed process {name}. Review the commands before saving it to Mewl.",
  "command.nameRequired": "Managed services need a name before they can be saved.",
  "command.startRequired.script":
    "Script-based services need a launch script or command before they can be saved.",
  "command.startRequired.docker": "Docker-managed services need a start flow before they can be saved.",
  "command.startRequired.command": "Managed services need a start command before they can be saved.",
  "command.cwdRequired": "Managed services need a working directory before they can be saved.",
  "command.editorHandlersMissing":
    "The Electron bridge is missing its managed-service editor handlers.",
  "command.editorNoResult": "The desktop bridge did not return a managed-service result.",
  "command.saveFailed": "The desktop bridge could not save the managed service.",
  "command.editorDesktopOnly": "Managed services can only be edited from the Electron desktop bridge.",
  "command.reviewConfirmFailed": "The desktop bridge could not confirm that cleanup review.",
  "command.reviewDesktopOnly":
    "Managed cleanup review can only be confirmed from the Electron desktop bridge.",
  "command.removeHandlersMissing": "The Electron bridge is missing its managed-service removal handler.",
  "command.removeFailed": "The desktop bridge could not remove the managed service.",
  "command.removeDesktopOnly":
    "Managed services can only be removed from the Electron desktop bridge.",
  "command.ruleNotWired": "This automation toggle is not wired to a live desktop setting yet.",
  "command.ruleSaveFailed": "The desktop bridge could not save that rule.",
  "command.ruleEnabled": "Enabled {rule}.",
  "command.ruleDisabled": "Disabled {rule}.",

  // Navigation — Terminal workspace / 侧边栏导航 — Terminal 工作区
  "nav.terminal": "Terminal",

  // Terminal workspace / Terminal 工作区
  "terminal.title": "Terminal",
  "terminal.subtitle": "Interactive PTY sessions for quick host work and service debugging.",
  "terminal.newSession": "New session",
  "terminal.newSessionAria": "Create a new terminal session",
  "terminal.cwdLabel": "Working directory",
  "terminal.cwdPlaceholder": "~/projects (blank = home)",
  "terminal.closeSession": "Close session",
  "terminal.sessionClosed": "Session ended (exit {code}).",
  "terminal.sessionKilled": "Session closed.",
  "terminal.noSessions": "No open terminal sessions.",
  "terminal.noSessionsDetail":
    "Start a new session, or run a managed service in a terminal from the Managed workspace.",
  "terminal.runInTerminal": "Run in terminal",
  "terminal.desktopOnly": "Terminal sessions require the Electron desktop bridge.",
  "terminal.createFailed": "The desktop bridge could not start a terminal session.",
  "terminal.killFailed": "The desktop bridge could not close that terminal session.",
  "terminal.commandTag": "cmd",

  // Settings modal / 设置弹窗
  "settings.title": "Settings",
  "settings.subtitle": "Desktop behavior, retention, and update preferences.",
  "settings.closeAria": "Close settings",
  "settings.desktopOnly": "Settings can only be changed from the Electron desktop bridge.",
  "settings.section.general": "General",
  "settings.section.retention": "History retention",
  "settings.section.updates": "Updates",
  "settings.showWindowOnStartup": "Show window on startup",
  "settings.showWindowOnStartupDetail": "Open the Mewl window when the desktop app launches.",
  "settings.closeToTray": "Close to tray",
  "settings.closeToTrayDetail": "Closing the window keeps Mewl running in the system tray.",
  "settings.logRetentionDays": "Log files retention (days)",
  "settings.logRetentionDaysDetail": "Daily service and system log files older than this are deleted.",
  "settings.historyRetentionDays": "Trend history retention (days)",
  "settings.historyRetentionDaysDetail": "Monitor trends and port history older than this are pruned.",
  "settings.autoCheckUpdates": "Check for updates automatically",
  "settings.autoCheckUpdatesDetail": "Ask GitHub Releases for new versions shortly after launch.",
  "settings.saved": "Settings saved.",
  "settings.saveFailed": "The desktop bridge could not save settings.",
  "settings.openLogs": "Open logs folder",
  "settings.openLogsFailed": "The desktop bridge could not open the logs folder.",
  "settings.updateUnsupported":
    "In-app updates require the packaged AppImage build. deb/rpm installs update through the system package manager.",
  "settings.checkUpdates": "Check for updates",
  "settings.downloadUpdate": "Download update",
  "settings.installUpdate": "Restart and update",
  "settings.updateChecking": "Checking for updates…",
  "settings.updateAvailable": "Version {version} is available.",
  "settings.updateNotAvailable": "You are on the latest version.",
  "settings.updateDownloading": "Downloading… {percent}%",
  "settings.updateDownloaded": "Version {version} downloaded and ready.",
  "settings.updateError": "Update check failed: {message}",
  "settings.updateIdle": "Not checked yet.",

  // Jobs / 一次性任务
  "jobs.sectionTitle": "One-time jobs",
  "jobs.badge": "job",
  "jobs.status.completed": "completed",
  "jobs.status.failed": "failed",
  "jobs.run": "Run",
  "jobs.runCount": "{count} run{|s}",
  "jobs.lastRunExit": "Last exit: {code}",

  // Editor additions / 编辑器新增
  "editor.lifecycle.title": "Run style",
  "editor.lifecycle.service": "Service",
  "editor.lifecycle.serviceDetail": "Long-running process with lifecycle controls.",
  "editor.lifecycle.job": "One-time job",
  "editor.lifecycle.jobDetail": "Runs once to completion; results land in history.",
  "editor.env.title": "Environment variables",
  "editor.env.detail": "Merged over the inherited environment when the service starts.",
  "editor.env.keyPlaceholder": "KEY",
  "editor.env.valuePlaceholder": "value",
  "editor.env.add": "Add variable",
  "editor.env.remove": "Remove variable",
  "editor.env.invalidKey": "Env keys must look like VAR_NAME.",

  // Monitor window selector / 监控时间窗口
  "monitor.window.15m": "15 minutes",
  "monitor.window.1h": "1 hour",
  "monitor.window.24h": "24 hours",
  "monitor.window.7d": "7 days",

  // Ports history / 端口历史
  "ports.history.title": "Recent binding history",
  "ports.history.empty": "No recorded bindings for this port yet.",
  "ports.history.bound": "bound",
  "ports.history.released": "released",

  // Logs page addition / 日志页新增
  "logs.openDirectory": "Open logs folder",

  // Status pills / 状态徽标
  "status.completed": "completed",
  "status.failed": "failed",
} as const;

export type TranslationKey = keyof typeof en;
