import {
  type CSSProperties,
  startTransition,
  useEffect,
  useDeferredValue,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Database,
  FolderOpen,
  Gauge,
  Globe,
  History,
  Languages,
  LayoutDashboard,
  ListChecks,
  PenSquare,
  Play,
  Plus,
  RefreshCw,
  Settings,
  ScrollText,
  Sparkles,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Pause,
  Play as PlayIcon,
  Trash2,
  Waypoints,
  Workflow,
  X,
} from "lucide-react";
import {
  CandyInput,
  HologramProgress,
  PulseLineChart,
  ShinyButton,
  SignalBars,
  StatusPill,
  SugarCard,
} from "./components/ui";
import { SettingsModal } from "./components/settings-modal";
import { TerminalView, RunInTerminalLauncher } from "./views/terminal-view";
import { MewlLocalizedError } from "./i18n/localized-error";
import { useI18n, type TranslationKey } from "./i18n";
import {
  type AlertRecord,
  type AlertSeverity,
  type AutomationHistoryEntry,
  type AutomationRule,
  type ManagedServiceColor,
  type ManagedServiceDraft,
  type ManagedServiceIcon,
  type ManagedServiceKind,
  type ManagedProcess,
  type ManagedServiceUpdate,
  type MonitorHistorySeries,
  type MonitorMetric,
  type MonitorWindow,
  type PortBinding,
  type ProcessLogEntry,
  type ProcessLogLevel,
  type PortStatus,
  type ProcessStatus,
  type RuntimeSnapshot,
  type UnifiedLogEvent,
  type UnifiedLogLevel,
  type WorkspaceView,
} from "./data/runtime";
import {
  getRuntimeSourceDescriptor,
  hydrateRuntimeSnapshot,
  type RuntimeActionResult,
} from "./runtime";

type StatusFilter = "all" | "active" | "watching" | "issues";
type RuntimeStatus = "loading" | "ready" | "error";
type ProcessAction = "start" | "stop" | "restart" | "scan" | "kill";
type AlertSeverityFilter = "all" | AlertSeverity;
type AlertTimeWindow = "all" | "1h" | "24h" | "7d";
type LogWorkspaceTab = "all" | "mewl" | "processes" | "containers" | "system";

type PersistedWorkspaceState = {
  version: 1;
  preferences: {
    activeView: WorkspaceView;
    query: string;
    statusFilter: StatusFilter;
    sidebarCollapsed: boolean;
    selectedProcessId: string;
    selectedManagedServiceId: string;
    expandedProcessIds: string[];
  };
  runtime: {
    processes: ManagedProcess[];
    ports: PortBinding[];
    alerts: AlertRecord[];
    automationRules: AutomationRule[];
    automationHistory: AutomationHistoryEntry[];
    monitorHistory: MonitorHistorySeries[];
    logs: UnifiedLogEvent[];
    // undefined signals "not persisted", letting the caller apply the
    // locale-aware default message instead of freezing English copy here.
    // undefined 表示“未持久化”，由调用方应用跟随语言的默认消息，
    // 避免在此处固化英文文案。
    commandState: string | undefined;
  };
};

const accent = {
  rose: "#ec4899",
  purple: "#8b5cf6",
  cyan: "#22d3ee",
  green: "#74f7b0",
  amber: "#fbbf24",
} as const;

const monitorMetricHexMap: Record<string, string> = {
  cpu: accent.amber,
  memory: accent.cyan,
  disk: accent.green,
  network: accent.purple,
  gpu: accent.rose,
};

// Navigation metadata. Labels are translation keys resolved at render time so
// a locale switch re-renders the sidebar without rebuilding anything.
// 导航元数据。label 是翻译键，渲染时解析，切换语言即可刷新侧边栏。
const viewMeta: Array<{
  id: WorkspaceView;
  labelKey: TranslationKey;
  icon: typeof LayoutDashboard;
  hex: string;
}> = [
  { id: "overview", labelKey: "nav.overview", icon: LayoutDashboard, hex: accent.rose },
  { id: "processes", labelKey: "nav.processes", icon: Server, hex: accent.cyan },
  { id: "managed", labelKey: "nav.managed", icon: Sparkles, hex: accent.rose },
  { id: "logs", labelKey: "nav.logs", icon: ScrollText, hex: accent.green },
  { id: "terminal", labelKey: "nav.terminal", icon: Terminal, hex: accent.cyan },
  { id: "ports", labelKey: "nav.ports", icon: Waypoints, hex: accent.purple },
  { id: "monitor", labelKey: "nav.monitor", icon: Activity, hex: accent.amber },
];

const statusFilterOptions: Array<{ id: StatusFilter; labelKey: TranslationKey }> = [
  { id: "all", labelKey: "filters.all" },
  { id: "active", labelKey: "filters.active" },
  { id: "watching", labelKey: "filters.watching" },
  { id: "issues", labelKey: "filters.issues" },
];

const alertSeverityOptions: Array<{ id: AlertSeverityFilter; labelKey: TranslationKey }> = [
  { id: "all", labelKey: "filters.all" },
  { id: "critical", labelKey: "severity.critical" },
  { id: "warning", labelKey: "severity.warning" },
  { id: "info", labelKey: "severity.info" },
];

// "1H"/"24H"/"7D" are locale-neutral shorthand; only "All Time" translates.
// “1H/24H/7D” 是各语言通用的简写，只有 “All Time” 需要翻译。
const alertTimeWindowOptions: Array<{ id: AlertTimeWindow; labelKey: TranslationKey | null; hours: number | null }> = [
  { id: "all", labelKey: "alerts.window.allTime", hours: null },
  { id: "1h", labelKey: null, hours: 1 },
  { id: "24h", labelKey: null, hours: 24 },
  { id: "7d", labelKey: null, hours: 24 * 7 },
];

const processToneMap: Record<ProcessStatus, "online" | "warning" | "offline" | "starting"> = {
  running: "online",
  degraded: "warning",
  stopped: "offline",
  starting: "starting",
  completed: "online",
  failed: "offline",
};

const processTextClassMap: Record<ProcessStatus, string> = {
  running: "text-emerald-200",
  degraded: "text-amber-200",
  stopped: "text-rose-200",
  starting: "text-cyan-200",
  completed: "text-emerald-200",
  failed: "text-rose-200",
};

const jobStatusLabelKeys: Record<"completed" | "failed", TranslationKey> = {
  completed: "jobs.status.completed",
  failed: "jobs.status.failed",
};

const monitorWindowOptions: Array<{ id: MonitorWindow; labelKey: TranslationKey }> = [
  { id: "15m", labelKey: "monitor.window.15m" },
  { id: "1h", labelKey: "monitor.window.1h" },
  { id: "24h", labelKey: "monitor.window.24h" },
  { id: "7d", labelKey: "monitor.window.7d" },
];

const lifecycleActionMeta: Record<
  Exclude<ProcessAction, "scan" | "kill">,
  { labelKey: TranslationKey; hex: string; icon: typeof Play }
> = {
  start: { labelKey: "action.start", hex: accent.green, icon: Play },
  stop: { labelKey: "action.stop", hex: accent.rose, icon: Square },
  restart: { labelKey: "action.restart", hex: accent.purple, icon: RefreshCw },
};

const severityToneMap: Record<AlertSeverity, "online" | "warning" | "offline"> = {
  info: "online",
  warning: "warning",
  critical: "offline",
};

const portTextClassMap: Record<PortStatus, string> = {
  bound: "text-emerald-200",
  booting: "text-cyan-200",
  standby: "text-white/58",
  conflict: "text-rose-200",
};

const panelClass = "glass-panel rounded-[34px] p-5 sm:p-6";

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const workspaceStorageKey = "mewl.workspace.v1";
const processLogTailLimit = 10;
const unifiedLogLimit = 1200;
const logRenderWindow = 400;
// Default command-strip message. Resolved through t() at usage sites so the
// initial value and resets follow the active locale.
// 命令栏默认消息。在使用处通过 t() 解析，初始值与重置都会跟随当前语言。
const defaultCommandStateKey = "command.ready" satisfies TranslationKey;
const appIconUrl = `${import.meta.env.BASE_URL}icon.png`;

const managedServiceColorMap: Record<ManagedServiceColor, string> = {
  default: "#ffffff",
  rose: accent.rose,
  purple: accent.purple,
  cyan: accent.cyan,
  green: accent.green,
  amber: accent.amber,
};

const managedServiceColorOptions: Array<{ id: ManagedServiceColor; labelKey: TranslationKey }> = [
  { id: "default", labelKey: "color.white" },
  { id: "rose", labelKey: "color.rose" },
  { id: "purple", labelKey: "color.purple" },
  { id: "cyan", labelKey: "color.cyan" },
  { id: "green", labelKey: "color.green" },
  { id: "amber", labelKey: "color.amber" },
];

const managedServiceIconMap: Record<ManagedServiceIcon, typeof Server> = {
  server: Server,
  terminal: Terminal,
  globe: Globe,
  database: Database,
  bot: Bot,
  workflow: Workflow,
  sparkles: Sparkles,
};

const managedServiceIconOptions: Array<{ id: ManagedServiceIcon; labelKey: TranslationKey }> = [
  { id: "server", labelKey: "icon.server" },
  { id: "terminal", labelKey: "icon.terminal" },
  { id: "globe", labelKey: "icon.globe" },
  { id: "database", labelKey: "icon.database" },
  { id: "bot", labelKey: "icon.bot" },
  { id: "workflow", labelKey: "icon.workflow" },
  { id: "sparkles", labelKey: "icon.sparkles" },
];

const managedServiceKindOptions: Array<{
  id: ManagedServiceKind;
  labelKey: TranslationKey;
  detailKey: TranslationKey;
}> = [
  {
    id: "command",
    labelKey: "kind.command",
    detailKey: "kind.command.detail",
  },
  {
    id: "script",
    labelKey: "kind.script",
    detailKey: "kind.script.detail",
  },
  {
    id: "docker",
    labelKey: "kind.docker",
    detailKey: "kind.docker.detail",
  },
];

// Per-kind editor copy. Command placeholders ("npm run dev") are executable
// examples, not prose, so they stay as literals.
// 各服务模式的编辑器文案。命令占位符（如 "npm run dev"）是可执行的示例
// 而非叙述文字，因此保持字面量。
const managedKindCopy: Record<
  ManagedServiceKind,
  {
    startLabelKey: TranslationKey;
    stopLabelKey: TranslationKey;
    restartLabelKey: TranslationKey;
    startPlaceholder: string;
    stopPlaceholderKey: TranslationKey;
    restartPlaceholderKey: TranslationKey;
    guidanceKey: TranslationKey;
  }
> = {
  command: {
    startLabelKey: "kind.command.startLabel",
    stopLabelKey: "kind.command.stopLabel",
    restartLabelKey: "kind.command.restartLabel",
    startPlaceholder: "npm run dev",
    stopPlaceholderKey: "kind.command.stopPlaceholder",
    restartPlaceholderKey: "kind.command.restartPlaceholder",
    guidanceKey: "kind.command.guidance",
  },
  script: {
    startLabelKey: "kind.script.startLabel",
    stopLabelKey: "kind.script.stopLabel",
    restartLabelKey: "kind.script.restartLabel",
    startPlaceholder: "./scripts/dev.sh --watch",
    stopPlaceholderKey: "kind.script.stopPlaceholder",
    restartPlaceholderKey: "kind.script.restartPlaceholder",
    guidanceKey: "kind.script.guidance",
  },
  docker: {
    startLabelKey: "kind.docker.startLabel",
    stopLabelKey: "kind.docker.stopLabel",
    restartLabelKey: "kind.docker.restartLabel",
    startPlaceholder: "docker compose up api",
    stopPlaceholderKey: "kind.docker.stopPlaceholder",
    restartPlaceholderKey: "kind.docker.restartPlaceholder",
    guidanceKey: "kind.docker.guidance",
  },
};

const logLevelTextClassMap: Record<ProcessLogLevel, string> = {
  info: "text-emerald-200",
  debug: "text-cyan-200",
  warning: "text-amber-200",
  error: "text-rose-200",
};

const unifiedLogLevelHexMap: Record<UnifiedLogLevel, string> = {
  fatal: accent.rose,
  error: accent.rose,
  warn: accent.amber,
  log: "rgba(255,255,255,0.7)",
  info: accent.cyan,
  success: accent.green,
  debug: accent.purple,
  trace: "#94a3b8",
};

const unifiedLogLevelOptions: Array<{ id: "all" | UnifiedLogLevel; labelKey: TranslationKey }> = [
  { id: "all", labelKey: "filters.all" },
  { id: "error", labelKey: "level.error" },
  { id: "warn", labelKey: "level.warn" },
  { id: "info", labelKey: "level.info" },
  { id: "success", labelKey: "level.success" },
  { id: "debug", labelKey: "level.debug" },
];

// "Mewl" is the product name and stays untranslated.
// “Mewl” 是产品名，不做翻译。
const logWorkspaceTabs: Array<{ id: LogWorkspaceTab; labelKey: TranslationKey }> = [
  { id: "all", labelKey: "filters.all" },
  { id: "mewl", labelKey: "logs.tab.mewl" },
  { id: "processes", labelKey: "logs.tab.processes" },
  { id: "containers", labelKey: "logs.tab.containers" },
  { id: "system", labelKey: "logs.tab.system" },
];

// Display labels for values that arrive as raw enum strings from the runtime
// (process/port status, severity, log levels, ownership tags, kind badges).
// 针对运行时以枚举字符串到达的取值（进程/端口状态、严重级别、日志级别、
// 归属标签、服务类型徽章）的展示文案映射。
const processStatusLabelKeys: Record<ProcessStatus, TranslationKey> = {
  running: "status.running",
  degraded: "status.degraded",
  stopped: "status.stopped",
  starting: "status.starting",
  completed: "status.completed",
  failed: "status.failed",
};

const portStatusLabelKeys: Record<PortStatus, TranslationKey> = {
  bound: "port.status.bound",
  booting: "port.status.booting",
  standby: "port.status.standby",
  conflict: "port.status.conflict",
};

const exposureLabelKeys: Record<PortBinding["exposure"], TranslationKey> = {
  public: "exposure.public",
  local: "exposure.local",
  internal: "exposure.internal",
};

const severityLabelKeys: Record<AlertSeverity, TranslationKey> = {
  info: "severity.info",
  warning: "severity.warning",
  critical: "severity.critical",
};

const unifiedLogLevelLabelKeys: Record<UnifiedLogLevel, TranslationKey> = {
  fatal: "level.fatal",
  error: "level.error",
  warn: "level.warn",
  log: "level.log",
  info: "level.info",
  success: "level.success",
  debug: "level.debug",
  trace: "level.trace",
};

const processLogLevelLabelKeys: Record<ProcessLogLevel, TranslationKey> = {
  info: "level.info",
  debug: "level.debug",
  warning: "level.warning",
  error: "level.error",
};

const restartPolicyLabelKeys: Record<ManagedProcess["restartPolicy"], TranslationKey> = {
  manual: "policy.manual",
  "on-failure": "policy.on-failure",
  always: "policy.always",
};

const formatLogStamp = () =>
  new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());

const trimLogTail = (entries: ProcessLogEntry[]) => entries.slice(-processLogTailLimit);

const mergeLogEvents = (current: UnifiedLogEvent[], incoming: UnifiedLogEvent[]) => {
  if (incoming.length === 0) {
    return current;
  }

  const merged = new Map(current.map((entry) => [entry.id, entry] as const));

  for (const entry of incoming) {
    merged.set(entry.id, entry);
  }

  return [...merged.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-unifiedLogLimit);
};

const formatUnifiedLogStamp = (timestamp: string) => {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return "--:--:--";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
};

const parseAlertAgeHours = (stamp: string) => {
  if (stamp === "now") {
    return 0;
  }

  const parsed = Date.parse(stamp);
  if (Number.isNaN(parsed)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - parsed) / (1000 * 60 * 60);
};

const createEmptyManagedDraft = (): ManagedServiceDraft => ({
  name: "",
  description: "",
  kind: "command",
  lifecycle: "service",
  startCommand: "",
  stopCommand: "",
  restartCommand: "",
  cwd: ".",
  autoStart: false,
  watchPorts: true,
  restartPolicy: "manual",
  restartLimit: 3,
  env: {},
  titleColor: "default",
  icon: "server",
});

const createDraftFromManagedProcess = (process: ManagedProcess): ManagedServiceDraft => ({
  name: process.name,
  description: process.description,
  kind: process.kind,
  lifecycle: process.lifecycle ?? "service",
  startCommand: process.startCommand ?? process.command,
  stopCommand: process.stopCommand ?? "",
  restartCommand: process.restartCommand ?? "",
  cwd: process.cwd,
  autoStart: process.autoStart,
  watchPorts: process.watchPorts,
  restartPolicy: process.restartPolicy,
  restartLimit: process.restartLimit,
  env: { ...(process.env ?? {}) },
  titleColor: process.titleColor ?? "default",
  icon: process.icon ?? "server",
});

const createDraftFromObservedProcess = (process: ManagedProcess): ManagedServiceDraft => ({
  name: process.name,
  description: `Managed from the observed runtime for ${process.name}.`,
  kind: process.runtime === "docker" ? "docker" : "command",
  lifecycle: "service",
  startCommand: process.command,
  stopCommand: "",
  restartCommand: "",
  cwd: process.cwd === "unknown" ? "." : process.cwd,
  autoStart: false,
  watchPorts: process.ports.length > 0,
  restartPolicy: "manual",
  restartLimit: 3,
  env: {},
  titleColor: "default",
  icon:
    process.runtime === "docker"
      ? "workflow"
      : process.runtime === "browser"
        ? "globe"
        : process.runtime === "python"
          ? "bot"
          : process.runtime === "electron"
            ? "sparkles"
            : "server",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return viewMeta.some((item) => item.id === value);
}

function isStatusFilter(value: unknown): value is StatusFilter {
  return statusFilterOptions.some((item) => item.id === value);
}

function readPersistedWorkspace(): PersistedWorkspaceState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(workspaceStorageKey);
  if (!rawValue) {
    return null;
  }

  const parsed: unknown = JSON.parse(rawValue);
  if (!isRecord(parsed) || parsed.version !== 1) {
    // Localized so the failure panel re-renders on locale switches.
    // 本地化错误，确保失败面板在切换语言时随之刷新。
    throw new MewlLocalizedError("error.incompatibleWorkspace");
  }

  const preferences = isRecord(parsed.preferences) ? parsed.preferences : {};
  const runtime = isRecord(parsed.runtime) ? parsed.runtime : {};

  return {
    version: 1,
    preferences: {
      activeView: isWorkspaceView(preferences.activeView) ? preferences.activeView : "overview",
      query: typeof preferences.query === "string" ? preferences.query : "",
      statusFilter: isStatusFilter(preferences.statusFilter) ? preferences.statusFilter : "all",
      sidebarCollapsed:
        typeof preferences.sidebarCollapsed === "boolean" ? preferences.sidebarCollapsed : false,
      selectedProcessId:
        typeof preferences.selectedProcessId === "string" ? preferences.selectedProcessId : "",
      selectedManagedServiceId:
        typeof preferences.selectedManagedServiceId === "string"
          ? preferences.selectedManagedServiceId
          : "",
      expandedProcessIds: Array.isArray(preferences.expandedProcessIds)
        ? preferences.expandedProcessIds.filter((value): value is string => typeof value === "string")
        : [],
    },
    runtime: {
      processes: Array.isArray(runtime.processes) ? (runtime.processes as ManagedProcess[]) : [],
      ports: Array.isArray(runtime.ports) ? (runtime.ports as PortBinding[]) : [],
      alerts: Array.isArray(runtime.alerts) ? (runtime.alerts as AlertRecord[]) : [],
      automationRules: Array.isArray(runtime.automationRules)
        ? (runtime.automationRules as AutomationRule[])
        : [],
      automationHistory: Array.isArray(runtime.automationHistory)
        ? (runtime.automationHistory as AutomationHistoryEntry[])
        : [],
      monitorHistory: Array.isArray(runtime.monitorHistory)
        ? (runtime.monitorHistory as MonitorHistorySeries[])
        : [],
      logs: Array.isArray(runtime.logs) ? (runtime.logs as UnifiedLogEvent[]) : [],
      commandState:
        typeof runtime.commandState === "string" ? runtime.commandState : undefined,
    },
  };
}

function writePersistedWorkspace(value: PersistedWorkspaceState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(workspaceStorageKey, JSON.stringify(value));
}

function App() {
  const { locale, setLocale, t } = useI18n();
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("loading");
  // Holds the raw thrown value so error copy re-resolves through t() whenever
  // the locale changes, instead of freezing the message at catch time.
  // 保存原始抛出值，使错误文案在语言切换时重新通过 t() 解析，
  // 而不是在捕获时就固化下来。
  const [runtimeError, setRuntimeError] = useState<unknown>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<AlertSeverityFilter>("all");
  const [alertServiceFilter, setAlertServiceFilter] = useState("all");
  const [alertTimeWindow, setAlertTimeWindow] = useState<AlertTimeWindow>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedProcessId, setSelectedProcessId] = useState("");
  const [selectedManagedServiceId, setSelectedManagedServiceId] = useState("");
  const [expandedProcessIds, setExpandedProcessIds] = useState<string[]>([]);
  const [expandedResourceDrawIds, setExpandedResourceDrawIds] = useState<string[]>([]);
  const [managedEditorMode, setManagedEditorMode] = useState<"create" | "edit">("edit");
  const [managedEditorOpen, setManagedEditorOpen] = useState(false);
  const [managedCleanupOnly, setManagedCleanupOnly] = useState(false);
  const [managedDraft, setManagedDraft] = useState<ManagedServiceDraft>(createEmptyManagedDraft);
  const [managedPrefillSourceId, setManagedPrefillSourceId] = useState("");
  const [processes, setProcesses] = useState<ManagedProcess[]>([]);
  const [ports, setPorts] = useState<PortBinding[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [monitorMetrics, setMonitorMetrics] = useState<MonitorMetric[]>([]);
  const [monitorHistory, setMonitorHistory] = useState<MonitorHistorySeries[]>([]);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [automationHistory, setAutomationHistory] = useState<AutomationHistoryEntry[]>([]);
  const [logs, setLogs] = useState<UnifiedLogEvent[]>([]);
  const [logWorkspaceTab, setLogWorkspaceTab] = useState<LogWorkspaceTab>("all");
  const [logQuery, setLogQuery] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState<"all" | UnifiedLogLevel>("all");
  const [logSourceFilter, setLogSourceFilter] = useState("all");
  const [logFollowTail, setLogFollowTail] = useState(true);
  const [logsPaused, setLogsPaused] = useState(false);
  const [monitorWindow, setMonitorWindow] = useState<MonitorWindow>("1h");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedPortIds, setExpandedPortIds] = useState<string[]>([]);
  const [commandState, setCommandState] = useState(() => t(defaultCommandStateKey));
  const [isPending, startActionTransition] = useTransition();
  const pausedLogBufferRef = useRef<UnifiedLogEvent[]>([]);
  const logsViewportRef = useRef<HTMLDivElement | null>(null);
  const runtimeSource = getRuntimeSourceDescriptor();
  const isLiveElectronRuntime = runtimeSource.id === "electron";
  const managedKindMeta = managedKindCopy[managedDraft.kind];

  // Render-time error localization: MewlLocalizedError carries a translation
  // key; Error messages from the Electron bridge arrive already localized.
  // 渲染时错误本地化：MewlLocalizedError 携带翻译键；来自 Electron 桥接的
  // Error 消息已在主进程完成本地化。
  const describeError = (error: unknown, fallbackKey: TranslationKey): string => {
    if (error instanceof MewlLocalizedError) {
      return t(error.messageKey);
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return t(fallbackKey);
  };

  const appendUnifiedLogs = (events: UnifiedLogEvent[]) => {
    if (events.length === 0) {
      return;
    }

    if (logsPaused) {
      pausedLogBufferRef.current = mergeLogEvents(pausedLogBufferRef.current, events);
      return;
    }

    setLogs((current) => mergeLogEvents(current, events));
  };

  const applyRuntimeSnapshot = (snapshot: RuntimeSnapshot) => {
    setProcesses(snapshot.processes);
    setPorts(snapshot.ports);
    setAlerts(snapshot.alerts);
    setMonitorMetrics(snapshot.monitorMetrics);
    setMonitorHistory(snapshot.monitorHistory);
    setAutomationRules(snapshot.automationRules);
    setAutomationHistory(snapshot.automationHistory);
    appendUnifiedLogs(snapshot.logs);
    setSelectedProcessId((current) =>
      snapshot.processes.some((process) => process.id === current)
        ? current
        : (snapshot.processes[0]?.id ?? ""),
    );
    setSelectedManagedServiceId((current) =>
      snapshot.processes.some((process) => process.id === current && process.managed)
        ? current
        : (snapshot.processes.find((process) => process.managed)?.id ?? ""),
    );
  };

  const applyRuntimeActionResult = (result: RuntimeActionResult) => {
    applyRuntimeSnapshot(result.snapshot);
    setCommandState(result.message);
    setAlertsOpen(false);
  };

  useEffect(() => {
    let cancelled = false;

    const bootRuntime = async () => {
      setRuntimeStatus("loading");
      setRuntimeError(null);

      try {
        // Sync the locale before the first snapshot so bridge-generated
        // alerts, logs, and labels are produced in the active language.
        // 首次快照前先同步语言，确保桥接生成的告警、日志与标签
        // 使用当前语言生成。
        await window.mewlHost?.setLocale?.(locale);

        const snapshot = await hydrateRuntimeSnapshot();
        if (cancelled) {
          return;
        }

        const persisted = readPersistedWorkspace();
        const hydratedProcesses = snapshot.processes;
        const hydratedPorts = snapshot.ports;
        const hydratedAlerts = snapshot.alerts;
        const hydratedAutomationRules = snapshot.automationRules;
        const hydratedAutomationHistory = snapshot.automationHistory;
        const hydratedMonitorHistory = snapshot.monitorHistory;
        const fallbackSelectedProcessId =
          hydratedProcesses[0]?.id ?? snapshot.processes[0]?.id ?? "";

        setProcesses(hydratedProcesses);
        setPorts(hydratedPorts);
        setAlerts(hydratedAlerts);
        setMonitorMetrics(snapshot.monitorMetrics);
        setMonitorHistory(hydratedMonitorHistory);
        setAutomationRules(hydratedAutomationRules);
        setAutomationHistory(hydratedAutomationHistory);
        setLogs(persisted?.runtime.logs?.length ? mergeLogEvents(persisted.runtime.logs, snapshot.logs) : snapshot.logs);
        setCommandState(persisted?.runtime.commandState ?? t(defaultCommandStateKey));
        setActiveView(persisted?.preferences.activeView ?? "overview");
        setQuery(persisted?.preferences.query ?? "");
        setStatusFilter(persisted?.preferences.statusFilter ?? "all");
        setSidebarCollapsed(persisted?.preferences.sidebarCollapsed ?? false);
        setExpandedProcessIds(persisted?.preferences.expandedProcessIds ?? []);
        setSelectedProcessId(
          persisted?.preferences.selectedProcessId || fallbackSelectedProcessId,
        );
        setSelectedManagedServiceId(
          persisted?.preferences.selectedManagedServiceId ||
            hydratedProcesses.find((process) => process.managed)?.id ||
            "",
        );
        setRuntimeStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRuntimeStatus("error");
        setRuntimeError(error);
      }
    };

    void bootRuntime();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (runtimeStatus !== "ready") {
      return;
    }

    writePersistedWorkspace({
      version: 1,
      preferences: {
        activeView,
        query,
        statusFilter,
        sidebarCollapsed,
        selectedProcessId,
        selectedManagedServiceId,
        expandedProcessIds,
      },
      runtime: {
        processes: isLiveElectronRuntime ? [] : processes,
        ports: isLiveElectronRuntime ? [] : ports,
        alerts: isLiveElectronRuntime ? [] : alerts,
        automationRules: isLiveElectronRuntime ? [] : automationRules,
        automationHistory: isLiveElectronRuntime ? [] : automationHistory,
        monitorHistory: isLiveElectronRuntime ? [] : monitorHistory,
        logs: isLiveElectronRuntime ? [] : logs,
        commandState,
      },
    });
  }, [
    activeView,
    alerts,
    automationRules,
    automationHistory,
    logs,
    monitorHistory,
    commandState,
    expandedProcessIds,
    ports,
    processes,
    query,
    runtimeStatus,
    selectedManagedServiceId,
    selectedProcessId,
    sidebarCollapsed,
    statusFilter,
  ]);

  useEffect(() => {
    if (runtimeStatus !== "ready" || selectedProcessId || processes.length === 0) {
      return;
    }

    setSelectedProcessId(processes.find((process) => process.status !== "stopped")?.id ?? "");
  }, [processes, runtimeStatus, selectedProcessId]);

  useEffect(() => {
    if (runtimeStatus !== "ready" || selectedManagedServiceId) {
      return;
    }

    setSelectedManagedServiceId(processes.find((process) => process.managed)?.id ?? "");
  }, [processes, runtimeStatus, selectedManagedServiceId]);

  useEffect(() => {
    if (!isLiveElectronRuntime || runtimeStatus !== "ready") {
      return;
    }

    const interval = window.setInterval(() => {
      void hydrateRuntimeSnapshot({ monitorWindow })
        .then((snapshot) => {
          setProcesses(snapshot.processes);
          setPorts(snapshot.ports);
          setAlerts(snapshot.alerts);
        setMonitorMetrics(snapshot.monitorMetrics);
        setMonitorHistory(snapshot.monitorHistory);
        setAutomationRules(snapshot.automationRules);
        setAutomationHistory(snapshot.automationHistory);
        appendUnifiedLogs(snapshot.logs);
      })
        .catch(() => {
          // Keep the current dashboard state when a background refresh misses once.
          // 后台刷新偶发失败时，保留当前仪表盘状态，不清空数据。
        });
    }, 6000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isLiveElectronRuntime, runtimeStatus, monitorWindow]);

  useEffect(() => {
    if (!isLiveElectronRuntime || runtimeStatus !== "ready") {
      return;
    }

    const unsubscribe = window.mewlHost?.subscribeToLogs?.((events) => {
      appendUnifiedLogs(events);
    });

    return () => {
      unsubscribe?.();
    };
  }, [isLiveElectronRuntime, logsPaused, runtimeStatus]);

  useEffect(() => {
    if (logsPaused || pausedLogBufferRef.current.length === 0) {
      return;
    }

    setLogs((current) => mergeLogEvents(current, pausedLogBufferRef.current));
    pausedLogBufferRef.current = [];
  }, [logsPaused]);

  const deferredQuery = useDeferredValue(query);
  const searchValue = deferredQuery.trim().toLowerCase();

  const filteredProcesses = processes.filter((process) => {
    const matchesQuery = searchValue
      ? [
          process.name,
          process.group,
          process.command,
          process.cwd,
          process.runtime,
          process.ports.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(searchValue)
      : true;

    const matchesStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "active"
          ? process.status !== "stopped"
          : statusFilter === "watching"
            ? process.watchPorts
            : process.status === "degraded" ||
              process.status === "stopped" ||
              process.status === "starting";

    return matchesQuery && matchesStatus;
  });

  const filteredPorts = ports.filter((port) =>
    searchValue
      ? [port.port, port.protocol, port.service, port.target, port.note]
          .join(" ")
          .toLowerCase()
          .includes(searchValue)
      : true,
  );
  const liveProcesses = filteredProcesses.filter((process) => process.status !== "stopped");
  const managedServices = filteredProcesses.filter((process) => process.managed);

  const selectedProcess =
    liveProcesses.find((process) => process.id === selectedProcessId) ??
    processes.find((process) => process.id === selectedProcessId) ??
    liveProcesses[0] ??
    processes.find((process) => process.status !== "stopped") ??
    null;
  const selectedManagedService =
    managedServices.find((process) => process.id === selectedManagedServiceId) ??
    processes.find((process) => process.id === selectedManagedServiceId && process.managed) ??
    managedServices[0] ??
    processes.find((process) => process.managed) ??
    null;
  const managedPrefillSource =
    managedPrefillSourceId.length > 0
      ? processes.find((process) => process.id === managedPrefillSourceId && !process.managed) ?? null
      : null;
  const managedServicesNeedingReview = managedServices.filter(
    (process) => process.review?.needsReview,
  );
  const visibleManagedServices = managedCleanupOnly
    ? managedServicesNeedingReview
    : managedServices.filter((process) => process.lifecycle !== "job");
  const visibleManagedJobs = managedCleanupOnly ? [] : managedServices.filter((process) => process.lifecycle === "job");
  const canControlProcess = (process: ManagedProcess | null) =>
    runtimeStatus === "ready" && Boolean(process?.managed);

  const selectedPorts = selectedProcess
    ? ports.filter((port) => port.serviceId === selectedProcess.id)
    : [];

  const activeCount = processes.filter((process) => process.status !== "stopped").length;
  const degradedCount = processes.filter(
    (process) => process.status === "degraded" || process.status === "starting",
  ).length;
  const watchedCount = processes.filter((process) => process.watchPorts).length;
  const openPortCount = ports.filter((port) => port.status !== "standby").length;
  const conflictCount = ports.filter((port) => port.status === "conflict").length;
  const publicPortCount = ports.filter(
    (port) => port.exposure === "public" && port.status !== "standby",
  ).length;
  const autoStartCount = processes.filter((process) => process.autoStart).length;
  const hostCpu = monitorMetrics.find((metric) => metric.id === "cpu")?.value ?? 0;
  const hostMemory = monitorMetrics.find((metric) => metric.id === "memory")?.value ?? 0;
  const hostDisk = monitorMetrics.find((metric) => metric.id === "disk")?.value ?? 0;
  const hostNetwork = monitorMetrics.find((metric) => metric.id === "network")?.value ?? 0;
  const hostGpuMetric =
    monitorMetrics.find((metric) => metric.id === "gpu") ?? null;
  const hostGpu = hostGpuMetric?.value ?? 0;
  const monitorTrendCards = monitorHistory.filter((series) => series.id !== "gpu");
  const gpuTrendSeries = monitorHistory.find((series) => series.id === "gpu") ?? null;
  const busiestProcesses = [...processes]
    .sort((left, right) => right.cpu + right.memory / 20 - (left.cpu + left.memory / 20))
    .slice(0, 4);
  const previewProcesses = liveProcesses.slice(0, 4);
  const previewPorts = filteredPorts.filter((port) => port.status !== "standby").slice(0, 4);
  const dashboardMetrics = monitorMetrics.slice(0, 3);
  const activeRestartPolicyCount = processes.filter(
    (process) => process.managed && process.restartPolicy !== "manual",
  ).length;
  const alertServiceOptions = Array.from(
    new Set(alerts.map((item) => item.serviceName).filter((value): value is string => Boolean(value))),
  );
  const selectedAlertTimeWindow = alertTimeWindowOptions.find((option) => option.id === alertTimeWindow);
  const filteredAlerts = alerts.filter((item) => {
    const matchesSeverity =
      alertSeverityFilter === "all" ? true : item.severity === alertSeverityFilter;
    const matchesService =
      alertServiceFilter === "all" ? true : item.serviceName === alertServiceFilter;
    const matchesTimeWindow =
      selectedAlertTimeWindow?.hours == null
        ? true
        : parseAlertAgeHours(item.stamp) <= selectedAlertTimeWindow.hours;

    return matchesSeverity && matchesService && matchesTimeWindow;
  });
  const deferredLogQuery = useDeferredValue(logQuery);
  const logSearchValue = deferredLogQuery.trim().toLowerCase();
  const tabFilteredLogs = logs.filter((entry) => {
    if (logWorkspaceTab === "mewl") {
      return entry.category === "internal" || entry.category === "automation" || entry.category === "alert";
    }

    if (logWorkspaceTab === "processes") {
      return entry.category === "managed-stdout" || entry.category === "managed-stderr" || entry.category === "container";
    }

    if (logWorkspaceTab === "containers") {
      return entry.category === "container";
    }

    if (logWorkspaceTab === "system") {
      return entry.category === "system";
    }

    return true;
  });
  const logSourceOptions = Array.from(
    new Set(tabFilteredLogs.map((entry) => entry.sourceLabel).filter((value) => value.length > 0)),
  );
  const filteredLogs = tabFilteredLogs.filter((entry) => {
    const matchesSearch = logSearchValue
      ? [entry.source, entry.sourceLabel, entry.category, entry.message, entry.serviceName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(logSearchValue)
      : true;
    const matchesLevel = logLevelFilter === "all" ? true : entry.level === logLevelFilter;
    const matchesSource = logSourceFilter === "all" ? true : entry.sourceLabel === logSourceFilter;
    return matchesSearch && matchesLevel && matchesSource;
  });
  const visibleLogs = filteredLogs.slice(-logRenderWindow).reverse();

  useEffect(() => {
    if (activeView !== "logs" || !logFollowTail || visibleLogs.length === 0) {
      return;
    }

    logsViewportRef.current?.scrollTo({ top: 0 });
  }, [activeView, logFollowTail, visibleLogs]);
  const runtimeIndicatorTone =
    runtimeStatus === "ready"
      ? "online"
      : runtimeStatus === "error"
        ? "offline"
        : "starting";

  const restoreDefaultWorkspace = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(workspaceStorageKey);
    }

    setQuery("");
    setStatusFilter("all");
    setSidebarCollapsed(false);
    setExpandedProcessIds([]);
    setManagedCleanupOnly(false);
    setManagedEditorOpen(false);
    setAlertsOpen(false);
    setAlertSeverityFilter("all");
    setAlertServiceFilter("all");
    setAlertTimeWindow("all");
    setLogWorkspaceTab("all");
    setLogQuery("");
    setLogLevelFilter("all");
    setLogSourceFilter("all");
    setLogFollowTail(true);
    setLogsPaused(false);
    pausedLogBufferRef.current = [];
    setManagedEditorMode("edit");
    setManagedDraft(createEmptyManagedDraft());
    setManagedPrefillSourceId("");
    setAutomationHistory([]);
    setMonitorHistory([]);
    setLogs([]);

    void hydrateRuntimeSnapshot()
      .then((snapshot) => {
        setProcesses(snapshot.processes);
        setPorts(snapshot.ports);
        setAlerts(snapshot.alerts);
        setMonitorMetrics(snapshot.monitorMetrics);
        setMonitorHistory(snapshot.monitorHistory);
        setAutomationRules(snapshot.automationRules);
        setAutomationHistory(snapshot.automationHistory);
        setLogs(snapshot.logs);
        setCommandState(t(defaultCommandStateKey));
        setActiveView("overview");
        setSelectedProcessId(snapshot.processes[0]?.id ?? "");
        setSelectedManagedServiceId(snapshot.processes.find((process) => process.managed)?.id ?? "");
        setRuntimeError(null);
        setRuntimeStatus("ready");
      })
      .catch((error) => {
        setRuntimeStatus("error");
        setRuntimeError(error);
      });
  };

  useEffect(() => {
    if (managedEditorMode === "create") {
      return;
    }

    if (!managedEditorOpen) {
      return;
    }

    if (selectedManagedService) {
      setManagedDraft(createDraftFromManagedProcess(selectedManagedService));
      setManagedPrefillSourceId("");
      return;
    }

    setManagedDraft(createEmptyManagedDraft());
    setManagedPrefillSourceId("");
  }, [managedEditorMode, managedEditorOpen, selectedManagedServiceId]);

  useEffect(() => {
    if (!managedEditorOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setManagedEditorOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [managedEditorOpen]);

  const createProcessLogEntry = (level: ProcessLogLevel, text: string): ProcessLogEntry => ({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stamp: formatLogStamp(),
    level,
    text,
  });

  const appendProcessLogs = (processId: string, entries: Array<ProcessLogEntry & { stream: "stdout" | "stderr" }>) => {
    setProcesses((current) =>
      current.map((process) => {
        if (process.id !== processId) {
          return process;
        }

        const stdoutEntries = entries
          .filter((entry) => entry.stream === "stdout")
          .map(({ stream: _stream, ...entry }) => entry);
        const stderrEntries = entries
          .filter((entry) => entry.stream === "stderr")
          .map(({ stream: _stream, ...entry }) => entry);

        return {
          ...process,
          logs: {
            stdout: trimLogTail([...process.logs.stdout, ...stdoutEntries]),
            stderr: trimLogTail([...process.logs.stderr, ...stderrEntries]),
          },
        };
      }),
    );
  };

  const pushAlert = ({
    title,
    detail,
    severity,
    stamp,
    serviceId,
    serviceName,
    category,
  }: Omit<AlertRecord, "id">) => {
    setAlerts((current) => [
      {
        id: `alert-${Date.now()}`,
        title,
        detail,
        severity,
        stamp,
        serviceId,
        serviceName,
        category,
      },
      ...current,
    ].slice(0, 6));
  };

  const changeView = (nextView: WorkspaceView) => {
    startTransition(() => {
      setActiveView(nextView);
      setAlertsOpen(false);
    });
  };

  const exportVisibleLogs = () => {
    const payload = visibleLogs
      .map((entry) => JSON.stringify(entry))
      .join("\n");

    const blob = new Blob([payload], { type: "application/x-ndjson;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeStamp = new Date().toISOString().replaceAll(":", "-");
    link.href = url;
    link.download = `mewl-logs-${safeStamp}.ndjson`;
    link.click();
    URL.revokeObjectURL(url);
    setCommandState(t("logs.exported", { count: visibleLogs.length }));
  };

  const toggleProcessExpanded = (processId: string) => {
    setExpandedProcessIds((current) =>
      current.includes(processId)
        ? current.filter((id) => id !== processId)
        : [...current, processId],
    );
  };

  const toggleResourceDrawExpanded = (processId: string) => {
    setExpandedResourceDrawIds((current) =>
      current.includes(processId)
        ? current.filter((id) => id !== processId)
        : [...current, processId],
    );
  };

  const handleProcessAction = (
    action: ProcessAction,
    processOverride?: ManagedProcess | null,
  ) => {
    if (runtimeStatus !== "ready") {
      return;
    }

    const targetProcess = processOverride ?? selectedProcess;

    if (isLiveElectronRuntime) {
      const hostAction = window.mewlHost?.performProcessAction;

      if (!hostAction) {
        setCommandState(t("command.bridgeMissingActions"));
        return;
      }

      if (action === "kill") {
        if (!targetProcess) {
          setCommandState(t("command.killChooseFirst"));
          return;
        }

        if (targetProcess.managed) {
          setCommandState(t("command.killManagedRejected"));
          return;
        }

        if (targetProcess.pid === null) {
          setCommandState(t("command.killNoPid"));
          return;
        }

        setCommandState(
          t("command.killDispatch", { name: targetProcess.name, pid: targetProcess.pid }),
        );

        startActionTransition(async () => {
          try {
            const result: RuntimeActionResult = await hostAction(action, targetProcess.id);
            applyRuntimeActionResult(result);
          } catch (error) {
            setCommandState(describeError(error, "command.killFailed"));
          }
        });

        return;
      }

      if (action !== "scan" && !targetProcess?.managed) {
        setCommandState(t("command.onlyManaged"));
        return;
      }

      setCommandState(
        action === "scan"
          ? t("command.scanDispatch")
          : t("command.actionDispatch", {
              verb: t(action === "start" ? "verb.start" : action === "stop" ? "verb.stop" : "verb.restart"),
              name: targetProcess?.name ?? t("command.fallbackServiceName"),
            }),
      );

      startActionTransition(async () => {
        try {
          const result: RuntimeActionResult = await hostAction(action, targetProcess?.id ?? "");
          applyRuntimeActionResult(result);
          if (targetProcess) {
            setSelectedProcessId(targetProcess.id);
          }
        } catch (error) {
          setCommandState(describeError(error, "command.actionFailed"));
        }
      });

      return;
    }

    if (action === "scan") {
      setCommandState(t("command.scanLocal"));

      if (targetProcess) {
        appendProcessLogs(targetProcess.id, [
          {
            ...createProcessLogEntry("debug", t("command.scanRequested")),
            stream: "stdout",
          },
        ]);
      }

      startActionTransition(async () => {
        await delay(320);

        if (targetProcess) {
          appendProcessLogs(targetProcess.id, [
            conflictCount > 0
              ? {
                  ...createProcessLogEntry(
                    "warning",
                    t("command.scanStillConflicts", { count: conflictCount }),
                  ),
                  stream: "stderr",
                }
              : {
                  ...createProcessLogEntry(
                    "info",
                    t("command.scanClean"),
                  ),
                  stream: "stdout",
                },
          ]);
        }

        pushAlert({
          title: t(conflictCount > 0 ? "command.scanAlert.drift.title" : "command.scanAlert.complete.title"),
          detail:
            conflictCount > 0
              ? t("command.scanAlert.drift.detail", { count: conflictCount })
              : t("command.scanAlert.clean.detail"),
          severity: conflictCount > 0 ? "warning" : "info",
          stamp: "now",
        });
        setCommandState(
          conflictCount > 0
            ? t("command.scanDoneConflicts")
            : t("command.scanDoneClean"),
        );
      });
      return;
    }

    if (action === "kill") {
      setCommandState(t("command.killDesktopOnly"));
      return;
    }

    if (!targetProcess) {
      return;
    }

    if (action === "start" && targetProcess.status === "running") {
      setCommandState(t("command.alreadyLive", { name: targetProcess.name }));
      pushAlert({
        title: t("command.noLaunchNeeded.title"),
        detail: t("command.noLaunchNeeded.detail", { name: targetProcess.name }),
        severity: "info",
        stamp: "now",
      });
      return;
    }

    if (action === "stop" && targetProcess.status === "stopped") {
      setCommandState(t("command.alreadyStopped", { name: targetProcess.name }));
      return;
    }

    const nextPid = (targetProcess.pid ?? 4200) + 17;
    const processConflictCount = ports.filter(
      (port) => port.serviceId === targetProcess.id && port.status === "conflict",
    ).length;

    appendProcessLogs(targetProcess.id, [
      {
        ...createProcessLogEntry(
          action === "restart" ? "warning" : "info",
          t(
            action === "start"
              ? "command.bootAccepted"
              : action === "stop"
                ? "command.stopQueued"
                : "command.restartQueued",
          ),
        ),
        stream: "stdout",
      },
    ]);

    setCommandState(
      t(
        action === "start"
          ? "command.starting"
          : action === "stop"
            ? "command.stopping"
            : "command.restarting",
        { name: targetProcess.name },
      ),
    );

    startActionTransition(async () => {
      setProcesses((current) =>
        current.map((process) => {
          if (process.id !== targetProcess.id) {
            return process;
          }

          if (action === "stop") {
            return {
              ...process,
              status: "stopped",
              pid: null,
              cpu: 0,
              memory: 72,
              network: 0,
              uptime: t("uptime.stopped"),
              lastExit: t("command.stopAlert.lastExit"),
              lastHeartbeat: t("heartbeat.idle"),
            };
          }

          return {
            ...process,
            status: "starting",
            pid: nextPid,
            uptime: t("heartbeat.booting"),
            lastHeartbeat: t("heartbeat.booting"),
          };
        }),
      );

      setPorts((current) =>
        current.map((port) =>
          port.serviceId === targetProcess.id
            ? {
                ...port,
                status: action === "stop" ? "standby" : "booting",
              }
            : port,
        ),
      );

      await delay(420);

      setProcesses((current) =>
        current.map((process) => {
          if (process.id !== targetProcess.id) {
            return process;
          }

          if (action === "stop") {
            return {
              ...process,
              lastHeartbeat: t("heartbeat.idle"),
            };
          }

          return {
            ...process,
            status: "running",
            pid: nextPid,
            cpu: Math.max(8, process.cpu - 4),
            memory: Math.max(120, process.memory - 32),
            network: Math.max(0, process.network - 3),
            uptime: t("uptime.justNow"),
            restarts: action === "restart" ? process.restarts + 1 : process.restarts,
            lastExit:
              action === "restart"
                ? t("command.restartAlert.lastExit")
                : process.lastExit,
            lastHeartbeat: t("uptime.justNow"),
          };
        }),
      );

      setPorts((current) =>
        current.map((port) =>
          port.serviceId === targetProcess.id
            ? {
                ...port,
                status: action === "stop" ? "standby" : "bound",
              }
            : port,
        ),
      );

      appendProcessLogs(targetProcess.id, [
        {
          ...createProcessLogEntry(
            "info",
            t(
              action === "start"
                ? "command.bootCompleted"
                : action === "stop"
                  ? "command.drainComplete"
                  : "command.restartCompleted",
              action === "stop" ? undefined : { pid: nextPid },
            ),
          ),
          stream: "stdout",
        },
        ...(action !== "stop" && processConflictCount > 0
          ? [
              {
                ...createProcessLogEntry(
                  "warning",
                  t("command.bindingConflicts", { count: processConflictCount }),
                ),
                stream: "stderr" as const,
              },
            ]
          : []),
      ]);

      pushAlert({
        title:
          action === "start"
            ? t("command.launchAlert.title", { name: targetProcess.name })
            : action === "stop"
              ? t("command.stopAlert.title", { name: targetProcess.name })
              : t("command.restartAlert.title", { name: targetProcess.name }),
        detail:
          action === "start"
            ? t("command.launchAlert.detail")
            : action === "stop"
              ? t("command.stopAlert.detail")
              : t("command.restartAlert.detail"),
        severity: "info",
        stamp: "now",
      });
      setCommandState(
        t(
          action === "start"
            ? "command.resultRunning"
            : action === "stop"
              ? "command.resultStopped"
              : "command.resultRestarted",
          { name: targetProcess.name },
        ),
      );
    });
  };

  const renderManagedLifecycleIcons = (process: ManagedProcess) => (
    <div className="flex items-center gap-2">
      {(["start", "stop", "restart"] as const).map((action) => {
        const { labelKey, hex, icon } = lifecycleActionMeta[action];
        return renderManagedActionButton({
          label: t(labelKey),
          icon,
          hex,
          disabled: !canControlProcess(process) || isPending || runtimeStatus !== "ready",
          onClick: () => {
            setSelectedManagedServiceId(process.id);
            handleProcessAction(action, process);
          },
        });
      })}
    </div>
  );

  const renderProcessOwnershipTag = (process: ManagedProcess) => (
    <span className="rounded-full border border-white/8 bg-black/18 px-3 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-white/48">
      {process.managed ? t("tag.managed") : t("tag.observed")}
    </span>
  );

  const renderManagedReviewTag = (process: ManagedProcess) =>
    process.review?.needsReview ? (
      <span className="rounded-full border border-amber-300/18 bg-amber-400/10 px-3 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-amber-100/76">
        {t("tag.needsCleanup")}
      </span>
    ) : null;

  const renderManagedKindTag = (process: ManagedProcess) =>
    process.managed ? (
      <span className="rounded-full border border-white/8 bg-black/18 px-3 py-1 text-[0.68rem] uppercase tracking-[0.2em] text-white/48">
        {t(`kind.${process.kind}` as TranslationKey)}
      </span>
    ) : null;

  const focusManagedServiceFromSnapshot = (snapshot: RuntimeSnapshot, processId: string) => {
    const matchedProcess =
      snapshot.processes.find((item) => item.id === processId && item.managed) ??
      snapshot.processes.find((item) => item.managed) ??
      null;

    if (matchedProcess) {
      setSelectedManagedServiceId(matchedProcess.id);
      setManagedEditorMode("edit");
    }
  };

  const openManagedCreateModal = (prefillSource?: ManagedProcess | null) => {
    setManagedEditorMode("create");
    setSelectedManagedServiceId("");
    setManagedPrefillSourceId(prefillSource?.id ?? "");
    setManagedDraft(prefillSource ? createDraftFromObservedProcess(prefillSource) : createEmptyManagedDraft());
    if (prefillSource) {
      setSelectedProcessId(prefillSource.id);
    }
    setManagedEditorOpen(true);
  };

  const openManagedEditModal = (process: ManagedProcess) => {
    setManagedEditorMode("edit");
    setSelectedManagedServiceId(process.id);
    setSelectedProcessId(process.id);
    setManagedPrefillSourceId("");
    setManagedEditorOpen(true);
  };

  const beginManagedDraftFromObservedProcess = (process: ManagedProcess) => {
    if (process.managed) {
      setCommandState(t("command.alreadyManaged"));
      changeView("managed");
      openManagedEditModal(process);
      return;
    }

    openManagedCreateModal(process);
    changeView("managed");
    setCommandState(t("command.prefilledDraft", { name: process.name }));
  };

  const saveManagedDraft = () => {
    if (runtimeStatus !== "ready") {
      return;
    }

    if (!managedDraft.name.trim()) {
      setCommandState(t("command.nameRequired"));
      return;
    }

    if (!managedDraft.startCommand.trim()) {
      setCommandState(
        t(
          managedDraft.kind === "script"
            ? "command.startRequired.script"
            : managedDraft.kind === "docker"
              ? "command.startRequired.docker"
              : "command.startRequired.command",
        ),
      );
      return;
    }

    if (!managedDraft.cwd.trim()) {
      setCommandState(t("command.cwdRequired"));
      return;
    }

    const envKeyPattern = /^[A-Z_][A-Z0-9_]*$/i;
    const invalidEnvKey = Object.keys(managedDraft.env).find(
      (key) => key.length === 0 || !envKeyPattern.test(key),
    );

    if (invalidEnvKey !== undefined) {
      setCommandState(t("editor.env.invalidKey"));
      return;
    }

    if (isLiveElectronRuntime) {
      const createManagedService = window.mewlHost?.createManagedService;
      const updateManagedService = window.mewlHost?.updateManagedService;

      if (
        (managedEditorMode === "create" && !createManagedService) ||
        (managedEditorMode === "edit" && !updateManagedService)
      ) {
        setCommandState(t("command.editorHandlersMissing"));
        return;
      }

      startActionTransition(async () => {
        try {
          const result =
            managedEditorMode === "create"
              ? await createManagedService?.(managedDraft)
              : await updateManagedService?.(selectedManagedServiceId, managedDraft);

          if (!result) {
            setCommandState(t("command.editorNoResult"));
            return;
          }

          applyRuntimeSnapshot(result.snapshot);
          setCommandState(result.message);
          setAlertsOpen(false);
          setManagedPrefillSourceId("");
          focusManagedServiceFromSnapshot(
            result.snapshot,
            managedEditorMode === "create"
              ? result.snapshot.processes.find(
                  (item) =>
                    item.managed &&
                    item.name === managedDraft.name &&
                    item.command === managedDraft.startCommand,
                )?.id ?? selectedManagedServiceId
              : selectedManagedServiceId,
          );
          setManagedEditorOpen(false);
        } catch (error) {
          setCommandState(describeError(error, "command.saveFailed"));
        }
      });
      return;
    }

    setCommandState(t("command.editorDesktopOnly"));
  };

  const confirmManagedReview = (processId: string) => {
    if (runtimeStatus !== "ready") {
      return;
    }

    if (isLiveElectronRuntime) {
      const updateManagedService = window.mewlHost?.updateManagedService;

      if (!updateManagedService) {
        setCommandState(t("command.editorHandlersMissing"));
        return;
      }

      startActionTransition(async () => {
        try {
          const result = await updateManagedService(processId, {
            clearReview: true,
          } satisfies ManagedServiceUpdate);
          applyRuntimeActionResult(result);
          focusManagedServiceFromSnapshot(result.snapshot, processId);
        } catch (error) {
          setCommandState(describeError(error, "command.reviewConfirmFailed"));
        }
      });
      return;
    }

    setCommandState(t("command.reviewDesktopOnly"));
  };

  const removeManagedDraft = () => {
    if (runtimeStatus !== "ready" || !selectedManagedServiceId) {
      return;
    }

    if (isLiveElectronRuntime) {
      const removeManagedService = window.mewlHost?.removeManagedService;

      if (!removeManagedService) {
        setCommandState(t("command.removeHandlersMissing"));
        return;
      }

      startActionTransition(async () => {
        try {
          const result = await removeManagedService(selectedManagedServiceId);
          applyRuntimeActionResult(result);
          setManagedEditorMode("create");
          setManagedDraft(createEmptyManagedDraft());
          setManagedEditorOpen(false);
        } catch (error) {
          setCommandState(describeError(error, "command.removeFailed"));
        }
      });
      return;
    }

    setCommandState(t("command.removeDesktopOnly"));
  };

  const renderManagedActionButton = ({
    label,
    icon: Icon,
    hex,
    onClick,
    disabled = false,
  }: {
    label: string;
    icon: typeof Play;
    hex: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-10 place-items-center rounded-[18px] border border-white/10 bg-black/18 text-white/70 transition duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
      style={{ boxShadow: `0 0 28px ${hex}18` }}
      disabled={disabled}
    >
      <Icon size={16} />
    </button>
  );

  const renderObservedActions = (process: ManagedProcess, compact = false) => {
    if (process.managed) {
      return null;
    }

    return (
      <div className={`flex flex-wrap items-center gap-3 ${compact ? "" : "mt-5"}`}>
        <ShinyButton
          label={t("action.createManagedDraft")}
          hex={accent.rose}
          icon={Sparkles}
          subtle
          onClick={() => beginManagedDraftFromObservedProcess(process)}
          disabled={runtimeStatus !== "ready"}
        />
        <ShinyButton
          label={t("action.killObservedPid")}
          hex={accent.rose}
          icon={Trash2}
          subtle
          onClick={() => handleProcessAction("kill", process)}
          disabled={isPending || runtimeStatus !== "ready" || process.pid === null}
        />
      </div>
    );
  };

  const toggleRule = (ruleId: string, nextValue: boolean) => {
    const rule = automationRules.find((item) => item.id === ruleId);

    if (isLiveElectronRuntime) {
      const applyAutomationRule = window.mewlHost?.applyAutomationRule;

      if (!applyAutomationRule) {
        setCommandState(t("command.ruleNotWired"));
        return;
      }

      startActionTransition(async () => {
        try {
          const result = await applyAutomationRule(ruleId, nextValue);
          applyRuntimeActionResult(result);
        } catch (error) {
          setCommandState(describeError(error, "command.ruleSaveFailed"));
        }
      });
      return;
    }

    setAutomationRules((current) =>
      current.map((item) => (item.id === ruleId ? { ...item, enabled: nextValue } : item)),
    );
    if (rule) {
      setCommandState(
        t(nextValue ? "command.ruleEnabled" : "command.ruleDisabled", {
          rule: rule.title,
        }),
      );
    }
  };

  const renderStatePanel = ({
    eyebrow,
    title,
    detail,
    hex,
    icon: Icon,
    actionLabel,
    onAction,
  }: {
    eyebrow: string;
    title: string;
    detail: string;
    hex: string;
    icon: typeof Terminal;
    actionLabel?: string;
    onAction?: () => void;
  }) => (
    <section className={panelClass}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs uppercase tracking-[0.24em] text-white/42">{eyebrow}</p>
          <h3 className="mt-3 text-3xl font-semibold text-white">{title}</h3>
          <p className="mt-3 max-w-xl text-sm text-white/58">{detail}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/72 transition duration-300 hover:border-white/18 hover:text-white"
              style={{ boxShadow: `0 18px 48px -34px ${hex}` }}
            >
              {actionLabel}
              <ArrowUpRight size={14} />
            </button>
          ) : null}
        </div>

        <div
          className="grid size-16 shrink-0 place-items-center rounded-[24px] border border-white/10 bg-black/18"
          style={{ boxShadow: `0 0 32px ${hex}22`, color: hex }}
        >
          <Icon size={24} />
        </div>
      </div>
    </section>
  );

  const renderAlertFeed = () => (
    <div className="space-y-2">
      <div className="rounded-[22px] border border-white/8 bg-[#10151c]/92 p-3">
        <div className="flex flex-wrap gap-2">
          {alertSeverityOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAlertSeverityFilter(option.id)}
              className={`rounded-full border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.22em] transition duration-300 ${
                alertSeverityFilter === option.id
                  ? "border-white/14 bg-black/26 text-white"
                  : "border-white/8 bg-black/18 text-white/42 hover:text-white/72"
              }`}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={alertServiceFilter}
            onChange={(event) => setAlertServiceFilter(event.target.value)}
            className="rounded-full border border-white/8 bg-black/18 px-3 py-2 text-[0.68rem] uppercase tracking-[0.22em] text-white/72 outline-none"
          >
            <option value="all">{t("alerts.allServices")}</option>
            {alertServiceOptions.map((serviceName) => (
              <option key={serviceName} value={serviceName}>
                {serviceName}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-2">
            {alertTimeWindowOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAlertTimeWindow(option.id)}
                className={`rounded-full border px-3 py-1.5 text-[0.68rem] uppercase tracking-[0.22em] transition duration-300 ${
                  alertTimeWindow === option.id
                    ? "border-white/14 bg-black/26 text-white"
                    : "border-white/8 bg-black/18 text-white/42 hover:text-white/72"
                }`}
              >
                {option.labelKey ? t(option.labelKey) : option.id.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="rounded-[22px] border border-white/8 bg-[#10151c]/92 px-4 py-5">
          <p className="text-sm font-semibold text-white/86">{t("alerts.empty.title")}</p>
          <p className="mt-2 text-sm text-white/52">
            {t("alerts.empty.detail")}
          </p>
        </div>
      ) : null}
      {filteredAlerts.map((item, index) => (
        <article
          key={item.id}
          className="rounded-[22px] border border-white/8 bg-[#10151c]/92 px-4 py-3"
          style={
            index === 0
              ? ({
                  boxShadow: `0 18px 42px -34px ${
                    item.severity === "critical"
                      ? accent.rose
                      : item.severity === "warning"
                        ? accent.amber
                        : accent.cyan
                  }`,
                } satisfies CSSProperties)
              : undefined
          }
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <StatusPill
                  tone={severityToneMap[item.severity]}
                  label={t(severityLabelKeys[item.severity])}
                />
                <p className="text-xs uppercase tracking-[0.22em] text-white/32">{item.stamp}</p>
                {item.serviceName ? (
                  <p className="text-xs uppercase tracking-[0.22em] text-white/32">
                    {item.serviceName}
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-sm font-semibold text-white/90">{item.title}</p>
                <p className="mt-1 text-sm text-white/54">{item.detail}</p>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );

  const renderInspector = () => {
    if (!selectedProcess) {
      return null;
    }

    const stdoutEntries = [...selectedProcess.logs.stdout].reverse();
    const stderrEntries = [...selectedProcess.logs.stderr].reverse();

    return (
      <section className={panelClass}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("inspector.eyebrow")}</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{selectedProcess.name}</h3>
          </div>
          <div className="grid size-11 place-items-center rounded-[20px] border border-white/10 bg-black/18">
            <ShieldCheck size={20} className="text-violet-300" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusPill
            tone={processToneMap[selectedProcess.status]}
            label={t(processStatusLabelKeys[selectedProcess.status])}
          />
          {renderProcessOwnershipTag(selectedProcess)}
          {renderManagedKindTag(selectedProcess)}
          <span className="rounded-full border border-white/8 bg-black/18 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/48">
            pid {selectedProcess.pid ?? t("field.none")}
          </span>
        </div>

        <p className="mt-4 text-sm text-white/56">{selectedProcess.description}</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [t("field.runtime"), selectedProcess.runtime],
            [t("field.uptime"), selectedProcess.uptime],
            [t("field.restarts"), `${selectedProcess.restarts}`],
            [t("field.lastPulse"), selectedProcess.lastHeartbeat],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[22px] border border-white/8 bg-black/18 px-4 py-4">
              <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">{label}</p>
              <p className="mt-2 text-sm font-medium text-white/86">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">{t("field.lastExit")}</p>
          <p className="mt-2 text-sm text-white/76">{selectedProcess.lastExit}</p>
        </div>

        <div className="mt-5 rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
          <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">{t("field.launchCommand")}</p>
          <p className="mt-2 font-mono text-sm text-white/80">{selectedProcess.command}</p>
          <p className="mt-3 font-mono text-xs text-white/42">{selectedProcess.cwd}</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {selectedPorts.length > 0 ? (
            selectedPorts.map((port) => (
              <span
                key={port.id}
                className="rounded-full border border-white/8 bg-black/18 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/58"
              >
                {port.port} {port.protocol}
              </span>
            ))
          ) : (
            <span className="rounded-full border border-white/8 bg-black/18 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/48">
              {t("inspector.noPorts")}
            </span>
          )}
        </div>

        {!selectedProcess.managed ? (
          <div className="mt-5 rounded-[24px] border border-rose-400/16 bg-rose-500/8 p-4">
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-rose-100/72">
              {t("inspector.observedOnly.title")}
            </p>
            <p className="mt-2 text-sm text-white/62">
              {t("inspector.observedOnly.detail")}
            </p>
            {renderObservedActions(selectedProcess)}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <HologramProgress label={t("inspector.cpuPressure")} value={selectedProcess.cpu} hex={accent.amber} />
          <HologramProgress
            label={t("inspector.memoryFootprint")}
            value={Math.min(100, Math.round((selectedProcess.memory / 1200) * 100))}
            hex={accent.cyan}
          />
          <HologramProgress
            label={t("inspector.networkLoad")}
            value={Math.min(100, selectedProcess.network * 2)}
            hex={accent.green}
          />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-[26px] border border-white/8 bg-[#0f141b]/94 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">stdout</p>
                <p className="mt-2 text-lg font-semibold text-white">{t("inspector.recentOutput")}</p>
              </div>
              <Terminal size={18} className="text-emerald-300" />
            </div>

            <div className="mt-4 space-y-3">
              {stdoutEntries.length > 0 ? (
                stdoutEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[20px] border border-white/8 bg-black/24 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-white/34">
                        {entry.stamp}
                      </p>
                      <p
                        className={`text-[0.68rem] font-semibold uppercase tracking-[0.2em] ${logLevelTextClassMap[entry.level]}`}
                      >
                        {t(processLogLevelLabelKeys[entry.level])}
                      </p>
                    </div>
                    <p className="mt-2 font-mono text-sm text-white/78">{entry.text}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-white/10 bg-black/18 px-4 py-5 text-sm text-white/48">
                  {t("inspector.noStdout")}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[26px] border border-white/8 bg-[#0f141b]/94 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">stderr</p>
                <p className="mt-2 text-lg font-semibold text-white">{t("inspector.recentIssues")}</p>
              </div>
              <Terminal size={18} className="text-rose-300" />
            </div>

            <div className="mt-4 space-y-3">
              {stderrEntries.length > 0 ? (
                stderrEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[20px] border border-white/8 bg-black/24 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.68rem] uppercase tracking-[0.2em] text-white/34">
                        {entry.stamp}
                      </p>
                      <p
                        className={`text-[0.68rem] font-semibold uppercase tracking-[0.2em] ${logLevelTextClassMap[entry.level]}`}
                      >
                        {t(processLogLevelLabelKeys[entry.level])}
                      </p>
                    </div>
                    <p className="mt-2 font-mono text-sm text-white/78">{entry.text}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-white/10 bg-black/18 px-4 py-5 text-sm text-white/48">
                  {t("inspector.noStderr")}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  };

  const renderOverview = () => (
    <>
      <section className="grid gap-4 xl:grid-cols-3">
        <SugarCard
          title={t("overview.services")}
          value={`${activeCount}/${processes.length}`}
          detail={t("overview.servicesDetail", { count: degradedCount })}
          hex={accent.green}
          icon={Server}
          status={degradedCount > 0 ? "warning" : "online"}
        />
        <SugarCard
          title={t("overview.openPorts")}
          value={`${openPortCount}`}
          detail={t("overview.publicBindings", { count: publicPortCount })}
          hex={accent.cyan}
          icon={Waypoints}
          status={conflictCount > 0 ? "warning" : "online"}
        />
        <SugarCard
          title={t("overview.watchers")}
          value={`${watchedCount}`}
          detail={t("overview.autostartEnabled", { count: autoStartCount })}
          hex={accent.purple}
          icon={ShieldCheck}
          status="online"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className={`${panelClass} flex h-full flex-col`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("overview.processes")}</p>
              <h3 className="mt-2 text-xl font-semibold text-white">{t("overview.runningNow")}</h3>
            </div>
            <StatusPill tone="online" label={t("overview.shownCount", { count: previewProcesses.length })} />
          </div>

          <div className="mt-5 flex-1 space-y-3">
            {previewProcesses.length > 0 ? (
              previewProcesses.map((process) => (
                <button
                  key={process.id}
                  type="button"
                  onClick={() => {
                    setSelectedProcessId(process.id);
                    changeView("processes");
                  }}
                  className="w-full rounded-[24px] border border-white/8 bg-[#0f141b]/94 px-4 py-4 text-left transition duration-300 hover:border-white/12 hover:bg-white/[0.03]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-semibold text-white/88 [overflow-wrap:anywhere]">
                        {process.name}
                      </p>
                      <p className="mt-1 break-words text-xs uppercase tracking-[0.22em] text-white/34 [overflow-wrap:anywhere]">
                        {process.command}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusPill
                        tone={processToneMap[process.status]}
                        label={t(processStatusLabelKeys[process.status])}
                      />
                      {renderProcessOwnershipTag(process)}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.ports")}</p>
                      <p className="mt-2 text-white/84">
                        {process.ports.length > 0 ? process.ports.join(", ") : t("field.none")}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.cpu")}</p>
                      <p className="mt-2 text-white/84">{process.cpu}%</p>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.memory")}</p>
                      <p className="mt-2 text-white/84">{process.memory} MB</p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-black/18 px-4 py-6 text-sm text-white/50">
                {t("overview.noProcesses")}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => changeView("processes")}
            className="mt-4 inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
          >
            {t("overview.seeAll")}
            <ArrowUpRight size={14} />
          </button>
        </div>

        <div className={`${panelClass} flex h-full flex-col`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("overview.bindings")}</p>
              <h3 className="mt-2 text-xl font-semibold text-white">{t("overview.portWatch")}</h3>
            </div>
            <StatusPill
              tone={conflictCount > 0 ? "warning" : "online"}
              label={t("overview.shownCount", { count: previewPorts.length })}
            />
          </div>

          <div className="mt-5 flex-1 space-y-3">
            {previewPorts.length > 0 ? (
              previewPorts.map((port) => (
                <button
                  key={port.id}
                  type="button"
                  onClick={() => changeView("ports")}
                  className="w-full rounded-[24px] border border-white/8 bg-[#0f141b]/94 px-4 py-4 text-left transition duration-300 hover:border-white/12 hover:bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white/88">{port.port}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.22em] text-white/34">
                        {port.service}
                      </p>
                    </div>
                    <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${portTextClassMap[port.status]}`}>
                      {t(portStatusLabelKeys[port.status])}
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.proto")}</p>
                      <p className="mt-2 text-white/84 uppercase">{port.protocol}</p>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.exposure")}</p>
                      <p className="mt-2 capitalize text-white/84">{t(exposureLabelKeys[port.exposure])}</p>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.target")}</p>
                      <p className="mt-2 truncate text-white/84">{port.target}</p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-black/18 px-4 py-6 text-sm text-white/50">
                {t("overview.noBindings")}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => changeView("ports")}
            className="mt-4 inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
          >
            {t("overview.seeAll")}
            <ArrowUpRight size={14} />
          </button>
        </div>
      </section>

      <section className={panelClass}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("overview.systemMonitor")}</p>
            <h3 className="mt-2 text-xl font-semibold text-white">{t("overview.basics")}</h3>
          </div>
          <button
            type="button"
            onClick={() => changeView("monitor")}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
          >
            {t("overview.openMonitor")}
            <ArrowUpRight size={14} />
          </button>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {dashboardMetrics.map((metric, index) => (
            <HologramProgress
              key={metric.id}
              label={metric.label}
              value={metric.value}
              hex={
                index === 0
                  ? accent.amber
                  : index === 1
                    ? accent.cyan
                    : accent.green
              }
            />
          ))}
        </div>
      </section>
    </>
  );

  const renderProcessesPage = () => (
    <>
      {liveProcesses.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-3">
          {liveProcesses.map((process) => {
          const isExpanded = expandedProcessIds.includes(process.id);
          const isSelected = selectedProcess?.id === process.id;

          return (
            <article
              key={process.id}
              className="glass-panel rounded-[32px] p-5 transition duration-300"
              style={
                isSelected
                  ? ({
                      boxShadow: `inset 0 0 0 1px ${accent.cyan}26, 0 24px 84px -56px ${accent.cyan}`,
                    } satisfies CSSProperties)
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() => setSelectedProcessId(process.id)}
                className="w-full min-w-0 text-left"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.22em] text-white/34">{process.group}</p>
                    <h3 className="mt-2 break-words text-xl font-semibold text-white [overflow-wrap:anywhere]">
                      {process.name}
                    </h3>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusPill
                      tone={processToneMap[process.status]}
                      label={t(processStatusLabelKeys[process.status])}
                    />
                    {renderProcessOwnershipTag(process)}
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.runtime")}</p>
                    <p className="mt-2 text-white/84">{process.runtime}</p>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.ports")}</p>
                    <p className="mt-2 text-white/84">
                      {process.ports.length > 0 ? process.ports.join(", ") : t("field.none")}
                    </p>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.pid")}</p>
                    <p className="mt-2 text-white/84">{process.pid ?? t("field.none")}</p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => toggleProcessExpanded(process.id)}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
              >
                {isExpanded ? t("processes.collapse") : t("processes.expand")}
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {isExpanded ? (
                <div className="mt-5 min-w-0 space-y-4 border-t border-white/8 pt-5">
                  <p className="break-words text-sm text-white/56 [overflow-wrap:anywhere]">
                    {process.description}
                  </p>
                  <div className="min-w-0 rounded-[20px] border border-white/8 bg-black/18 px-4 py-4">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.command")}</p>
                    <p className="mt-3 break-words font-mono text-sm leading-7 text-white/80 [overflow-wrap:anywhere]">
                      {process.command}
                    </p>
                    <p className="mt-3 break-words font-mono text-xs leading-6 text-white/42 [overflow-wrap:anywhere]">
                      {process.cwd}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.uptime")}</p>
                      <p className="mt-2 text-white/84">{process.uptime}</p>
                    </div>
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{t("field.restarts")}</p>
                      <p className="mt-2 text-white/84">{process.restarts}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <HologramProgress label={t("field.cpu")} value={process.cpu} hex={accent.amber} />
                    <HologramProgress
                      label={t("field.memory")}
                      value={Math.min(100, Math.round((process.memory / 1200) * 100))}
                      hex={accent.cyan}
                    />
                  </div>
                  {!process.managed ? (
                    <div className="rounded-[22px] border border-rose-400/14 bg-rose-500/8 p-4">
                      <p className="text-[0.72rem] uppercase tracking-[0.22em] text-rose-100/72">
                        {t("processes.observedActions.title")}
                      </p>
                      <p className="mt-2 text-sm text-white/60">
                        {t("processes.observedActions.detail")}
                      </p>
                      {renderObservedActions(process)}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
        </section>
      ) : (
        renderStatePanel({
          eyebrow: t("overview.processes"),
          title: t("processes.empty.title"),
          detail:
            searchValue.length > 0
              ? t("processes.empty.queryDetail", { query })
              : t("processes.empty.snapshotDetail"),
          hex: accent.cyan,
          icon: Server,
          actionLabel: t("processes.resetFilters"),
          onAction: () => {
            setQuery("");
            setStatusFilter("all");
          },
        })
      )}

      {liveProcesses.length > 0 ? renderInspector() : null}
    </>
  );

  const renderManagedPage = () => (
    <section className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("managed.eyebrow")}</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">{t("managed.title")}</h3>
        </div>
        <ShinyButton
          label={t("action.newService")}
          hex={accent.rose}
          icon={Plus}
          subtle
          onClick={() => openManagedCreateModal()}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {[
          [t("managed.stat.managed"), `${managedServices.length}`],
          [t("managed.stat.autostart"), `${autoStartCount}`],
          [t("managed.stat.guarded"), `${activeRestartPolicyCount}`],
          [t("managed.stat.cleanup"), `${managedServicesNeedingReview.length}`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[20px] border border-white/8 bg-black/18 px-4 py-3 text-sm"
          >
            <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{label}</p>
            <p className="mt-2 font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {managedServicesNeedingReview.length > 0 ? (
          <div className="rounded-[24px] border border-amber-300/16 bg-amber-400/8 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.22em] text-amber-100/72">
                  {t("managed.cleanup.title")}
                </p>
                <p className="mt-2 max-w-2xl text-sm text-white/66">
                  {t("managed.cleanup.detail", { count: managedServicesNeedingReview.length })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setManagedCleanupOnly((current) => !current)}
                  className={`rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition duration-300 ${
                    managedCleanupOnly
                      ? "border-amber-200/26 bg-amber-300/16 text-amber-50"
                      : "border-white/8 bg-black/18 text-white/66 hover:text-white"
                  }`}
                >
                  {managedCleanupOnly ? t("managed.showAll") : t("managed.showCleanupOnly")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const firstPending = managedServicesNeedingReview[0];
                    if (firstPending) {
                      openManagedEditModal(firstPending);
                    }
                  }}
                  className="rounded-full border border-white/8 bg-black/18 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
                >
                  {t("managed.reviewFirst")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {visibleManagedServices.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleManagedServices.map((process) => {
              const isSelected =
                selectedManagedService?.id === process.id && managedEditorMode === "edit" && managedEditorOpen;
              const titleHex = managedServiceColorMap[process.titleColor ?? "default"];
              const Icon = managedServiceIconMap[process.icon ?? "server"];

              return (
                <article
                  key={process.id}
                  className="rounded-[28px] border border-white/8 bg-[#0f141b]/94 p-5 transition duration-300"
                  style={
                    isSelected
                      ? ({
                          boxShadow: `inset 0 0 0 1px ${titleHex}30, 0 28px 86px -58px ${titleHex}`,
                        } satisfies CSSProperties)
                      : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <span
                        className="grid size-12 shrink-0 place-items-center rounded-[20px] border border-white/10 bg-black/18"
                        style={{
                          color: titleHex,
                          boxShadow: `0 0 28px ${titleHex}24`,
                        }}
                      >
                        <Icon size={20} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold" style={{ color: titleHex }}>
                          {process.name}
                        </p>
                        <p className="mt-1 text-sm text-white/54">
                          {process.description || t("managed.noDescription")}
                        </p>
                        <p className="mt-3 truncate font-mono text-xs text-white/34">
                          {process.startCommand ?? process.command}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <StatusPill
                        tone={processToneMap[process.status]}
                        label={t(processStatusLabelKeys[process.status])}
                      />
                      {renderManagedReviewTag(process)}
                      {renderManagedKindTag(process)}
                    </div>
                  </div>

                  {process.review?.needsReview ? (
                    <div className="mt-4 rounded-[18px] border border-amber-300/14 bg-amber-400/8 px-4 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-amber-100/72">
                        {t("managed.cleanupNotes")}
                      </p>
                      <p className="mt-2 text-sm text-white/64">
                        {process.review.reasons[0] ?? t("managed.cleanupFallback")}
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                    {[
                      [t("field.pid"), process.pid ? `${process.pid}` : t("field.idle")],
                      [t("field.ports"), process.ports.length > 0 ? process.ports.join(", ") : t("field.none")],
                      [t("managed.field.pulse"), process.lastHeartbeat],
                      [
                        t("managed.field.restart"),
                        process.restartPolicy === "manual"
                          ? t("policy.manual")
                          : t("managed.restartPolicyValue", {
                              policy: t(restartPolicyLabelKeys[process.restartPolicy]),
                              limit: process.restartLimit,
                            }),
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3"
                      >
                        <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">
                          {label}
                        </p>
                        <p className="mt-2 text-sm text-white/84">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      {
                        id: `service-autostart:${process.id}`,
                        label: t("managed.stat.autostart"),
                        detail: t("managed.autostart.detail"),
                        enabled: process.autoStart,
                        hex: accent.rose,
                      },
                      {
                        id: `service-watch:${process.id}`,
                        label: t("managed.watchPorts.label"),
                        detail: t("managed.watchPorts.detail"),
                        enabled: process.watchPorts,
                        hex: accent.cyan,
                      },
                    ].map((setting) => (
                      <div
                        key={setting.id}
                        title={setting.detail}
                        className="rounded-[20px] border border-white/8 bg-black/18 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-white/88">{setting.label}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleRule(setting.id, !setting.enabled)}
                            disabled={isPending || runtimeStatus !== "ready"}
                            title={setting.detail}
                            aria-label={`${setting.label}: ${setting.detail}`}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition duration-300 ${
                              isPending || runtimeStatus !== "ready"
                                ? "cursor-not-allowed border-white/8 bg-black/18 text-white/34"
                                : "border-white/10 bg-[#0f141b]/94 text-white/70 hover:border-white/18 hover:text-white"
                            }`}
                            style={
                              setting.enabled
                                ? ({
                                    boxShadow: `0 0 24px ${setting.hex}22`,
                                  } satisfies CSSProperties)
                                : undefined
                            }
                          >
                            <span
                              className="size-2.5 rounded-full"
                              style={{
                                backgroundColor: setting.enabled
                                  ? setting.hex
                                  : "rgba(255,255,255,0.26)",
                              }}
                            />
                            {setting.enabled ? t("managed.on") : t("managed.off")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
                    {renderManagedLifecycleIcons(process)}
                    <div className="flex items-center gap-2">
                      {process.review?.needsReview
                        ? renderManagedActionButton({
                            label: t("action.confirmCleanupReview"),
                            icon: ShieldCheck,
                            hex: accent.amber,
                            onClick: () => confirmManagedReview(process.id),
                            disabled: isPending || runtimeStatus !== "ready",
                          })
                        : null}
                      {renderManagedActionButton({
                        label: t("action.editService"),
                        icon: PenSquare,
                        hex: titleHex,
                        onClick: () => openManagedEditModal(process),
                      })}
                      <RunInTerminalLauncher
                        process={process}
                        accent={accent}
                        onLaunched={(view) => changeView(view)}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-white/10 bg-black/18 px-5 py-8 text-sm text-white/52">
            {managedCleanupOnly
              ? t("managed.empty.cleanupOnly")
              : t("managed.empty.create")}
          </div>
        )}

        {visibleManagedJobs.length > 0 ? (
          <div className="pt-2">
            <p className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-white/42">
              <ListChecks size={14} />
              {t("jobs.sectionTitle")}
            </p>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {visibleManagedJobs.map((process) => {
                const titleHex = managedServiceColorMap[process.titleColor ?? "default"];
                const Icon = managedServiceIconMap[process.icon ?? "server"];
                const jobRunning = process.status === "starting" || process.status === "running";

                return (
                  <article
                    key={process.id}
                    className="rounded-[28px] border border-white/8 bg-[#0f141b]/94 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-4">
                        <span
                          className="grid size-12 shrink-0 place-items-center rounded-[20px] border border-white/10 bg-black/18"
                          style={{ color: titleHex, boxShadow: `0 0 28px ${titleHex}24` }}
                        >
                          <Icon size={20} />
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate text-lg font-semibold" style={{ color: titleHex }}>
                            {process.name}
                            <span
                              className="rounded-full px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.16em] text-white/70"
                              style={{ backgroundColor: `${accent.amber}22` }}
                            >
                              {t("jobs.badge")}
                            </span>
                          </p>
                          <p className="mt-1 truncate font-mono text-xs text-white/34">
                            {process.startCommand ?? process.command}
                          </p>
                          <p className="mt-2 text-xs text-white/48">
                            {t("jobs.runCount", { count: process.runCount ?? 0 })}
                            {process.lastRunExit != null
                              ? ` · ${t("jobs.lastRunExit", { code: process.lastRunExit })}`
                              : ""}
                          </p>
                        </div>
                      </div>

                      <StatusPill
                        tone={processToneMap[process.status]}
                        label={
                          process.status === "completed"
                            ? t("jobs.status.completed")
                            : process.status === "failed"
                              ? t("jobs.status.failed")
                              : undefined
                        }
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
                      {jobRunning ? (
                        <StatusPill tone="starting" label={t("action.stop")} />
                      ) : (
                        renderManagedActionButton({
                          label: t("jobs.run"),
                          icon: Play,
                          hex: accent.green,
                          onClick: () => handleProcessAction("start", process),
                          disabled: isPending || runtimeStatus !== "ready",
                        })
                      )}
                      <div className="flex items-center gap-2">
                        <RunInTerminalLauncher
                          process={process}
                          accent={accent}
                          onLaunched={(view) => changeView(view)}
                        />
                        {renderManagedActionButton({
                          label: t("action.editService"),
                          icon: PenSquare,
                          hex: titleHex,
                          onClick: () => openManagedEditModal(process),
                        })}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        {automationHistory.length > 0 ? (
          <div className="pt-2">
            <p className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-white/42">
              <History size={14} />
              {t("jobs.historyTitle")}
            </p>
            <div className="mt-4 grid gap-2">
              {automationHistory.slice(0, 8).map((entry) => {
                const outcomeColor =
                  entry.outcome === "error"
                    ? "#fb7185"
                    : entry.outcome === "warning"
                      ? "#fbbf24"
                      : "#6ee7b7";
                const stampMs = Date.parse(entry.stamp);
                const stampText = Number.isNaN(stampMs)
                  ? "--:--:--"
                  : new Intl.DateTimeFormat("en-US", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(new Date(stampMs));

                return (
                  <div
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-[18px] border border-white/8 bg-black/18 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/78">{entry.title}</p>
                      {entry.detail ? (
                        <p className="mt-0.5 truncate text-xs text-white/40">{entry.detail}</p>
                      ) : null}
                    </div>
                    <span
                      className="shrink-0 text-[0.62rem] font-semibold uppercase tracking-[0.16em]"
                      style={{ color: outcomeColor }}
                    >
                      {stampText}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );

  const renderLogsPage = () => (
    <section className="grid gap-5">
      <div className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("nav.logs")}</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{t("logs.title")}</h3>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLogsPaused((current) => !current)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/72 transition duration-300 hover:border-white/18 hover:text-white"
            >
              {logsPaused ? <PlayIcon size={14} /> : <Pause size={14} />}
              {logsPaused ? t("action.resume") : t("action.pause")}
            </button>
            <button
              type="button"
              onClick={() => setLogFollowTail((current) => !current)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition duration-300 ${
                logFollowTail
                  ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                  : "border-white/10 bg-black/18 text-white/60 hover:text-white"
              }`}
            >
              {t("logs.followTail")}
            </button>
            <button
              type="button"
              onClick={() => {
                setLogs([]);
                pausedLogBufferRef.current = [];
                setCommandState(t("logs.cleared"));
              }}
              className="rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/72 transition duration-300 hover:border-white/18 hover:text-white"
            >
              {t("action.clear")}
            </button>
            <button
              type="button"
              onClick={exportVisibleLogs}
              disabled={visibleLogs.length === 0}
              className="rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/72 transition duration-300 hover:border-white/18 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("action.export")}
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await window.mewlHost?.openLogsDirectory?.();
                if (!ok) {
                  setCommandState(t("settings.openLogsFailed"));
                }
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/72 transition duration-300 hover:border-white/18 hover:text-white"
            >
              <FolderOpen size={14} />
              {t("logs.openDirectory")}
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {logWorkspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setLogWorkspaceTab(tab.id);
                setLogSourceFilter("all");
              }}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition duration-300 ${
                logWorkspaceTab === tab.id
                  ? "border-white/14 bg-black/26 text-white"
                  : "border-white/8 bg-black/18 text-white/42 hover:text-white/72"
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_auto_auto]">
          <CandyInput
            value={logQuery}
            onChange={setLogQuery}
            hex={accent.green}
            placeholder={t("logs.searchPlaceholder")}
          />

          <select
            value={logSourceFilter}
            onChange={(event) => setLogSourceFilter(event.target.value)}
            className="rounded-[22px] border border-white/10 bg-[#0f141b]/94 px-4 py-3 text-sm text-white/78 outline-none"
          >
            <option value="all">{t("logs.allSources")}</option>
            {logSourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap gap-2">
            {unifiedLogLevelOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLogLevelFilter(option.id)}
                className={`rounded-full border px-3 py-2 text-[0.68rem] uppercase tracking-[0.22em] transition duration-300 ${
                  logLevelFilter === option.id
                    ? "border-white/14 bg-black/26 text-white"
                    : "border-white/8 bg-black/18 text-white/42 hover:text-white/72"
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {[
            [t("logs.stat.captured"), `${tabFilteredLogs.length}`],
            [t("logs.stat.visible"), `${visibleLogs.length}`],
            [t("logs.stat.buffered"), `${pausedLogBufferRef.current.length}`],
            [t("logs.stat.sources"), `${logSourceOptions.length}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-[20px] border border-white/8 bg-black/18 px-4 py-3 text-sm"
            >
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{label}</p>
              <p className="mt-2 font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 overflow-hidden rounded-[28px] border border-white/8 bg-[#0a0f15]/96">
          <div className="flex items-center justify-between gap-4 border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-rose-400/90" />
              <span className="size-2.5 rounded-full bg-amber-300/90" />
              <span className="size-2.5 rounded-full bg-emerald-300/90" />
            </div>
            <p className="text-[0.68rem] uppercase tracking-[0.22em] text-white/38">
              {logsPaused ? t("logs.mode.paused") : logFollowTail ? t("logs.mode.live") : t("logs.mode.manual")}
            </p>
          </div>

          <div
            ref={logsViewportRef}
            onScroll={(event) => {
              if (!logFollowTail) {
                return;
              }

              if (event.currentTarget.scrollTop > 24) {
                setLogFollowTail(false);
              }
            }}
            className="max-h-[72vh] overflow-y-auto px-3 py-3"
          >
            {visibleLogs.length > 0 ? (
              <div className="space-y-2 font-mono text-[0.84rem] leading-6">
                {visibleLogs.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-[18px] border border-white/6 bg-white/[0.02] px-3 py-3 transition duration-300 hover:border-white/10 hover:bg-white/[0.04]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.68rem] uppercase tracking-[0.2em] text-white/34">
                        {formatUnifiedLogStamp(entry.timestamp)}
                      </span>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[0.64rem] font-semibold uppercase tracking-[0.2em]"
                        style={{
                          color: unifiedLogLevelHexMap[entry.level],
                          borderColor: `${unifiedLogLevelHexMap[entry.level]}30`,
                          backgroundColor: `${unifiedLogLevelHexMap[entry.level]}12`,
                        }}
                      >
                        {t(unifiedLogLevelLabelKeys[entry.level])}
                      </span>
                      <span className="rounded-full border border-white/8 bg-black/18 px-2.5 py-1 text-[0.64rem] uppercase tracking-[0.2em] text-white/44">
                        {entry.sourceLabel}
                      </span>
                      <span className="rounded-full border border-white/8 bg-black/18 px-2.5 py-1 text-[0.64rem] uppercase tracking-[0.2em] text-white/34">
                        {entry.category}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-white/82">
                      {entry.message}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-black/18 px-4 py-8 text-sm text-white/48">
                {t("logs.empty")}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  const renderManagedEditorModal = () => {
    if (!managedEditorOpen || typeof document === "undefined") {
      return null;
    }

    return createPortal(
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-[#05070bcc]/90 px-4 py-6 backdrop-blur-md"
        onClick={() => setManagedEditorOpen(false)}
      >
        <div
          className="glass-panel max-h-[calc(100vh-3rem)] w-full max-w-[920px] overflow-hidden rounded-[34px]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-5 sm:px-6">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/42">
                {managedEditorMode === "create"
                  ? managedPrefillSource
                    ? t("editor.title.createFromObserved")
                    : t("editor.title.create")
                  : t("editor.title.edit")}
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                {managedEditorMode === "create"
                  ? managedPrefillSource
                    ? t("editor.heading.createFromObserved")
                    : t("editor.heading.create")
                  : selectedManagedService?.name ?? t("editor.heading.fallback")}
              </h3>
            </div>

            <div className="flex items-center gap-2">
              {managedEditorMode === "edit" && selectedManagedService ? (
                renderManagedActionButton({
                  label: t("action.removeManagedService"),
                  icon: Trash2,
                  hex: accent.rose,
                  onClick: removeManagedDraft,
                  disabled: isPending || runtimeStatus !== "ready",
                })
              ) : null}
              <button
                type="button"
                onClick={() => setManagedEditorOpen(false)}
                className="grid size-10 place-items-center rounded-[18px] border border-white/10 bg-black/18 text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
                aria-label={t("editor.closeAria")}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="max-h-[calc(100vh-11rem)] overflow-y-auto px-5 py-5 sm:px-6">
            <div className="space-y-4">
              {managedEditorMode === "create" && managedPrefillSource ? (
                <div className="rounded-[24px] border border-rose-400/16 bg-rose-500/8 p-4">
                  <p className="text-[0.72rem] uppercase tracking-[0.22em] text-rose-100/72">
                    {t("editor.prefill.title")}
                  </p>
                  <p className="mt-2 text-sm text-white/62">
                    {t("editor.prefill.detail", {
                      name: managedPrefillSource.name,
                      pid: managedPrefillSource.pid ?? t("field.none"),
                    })}
                  </p>
                  <div className="mt-4 rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                    <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">
                      {t("editor.prefill.commandLabel")}
                    </p>
                    <p className="mt-2 break-all font-mono text-sm text-white/80">
                      {managedPrefillSource.command}
                    </p>
                  </div>
                </div>
              ) : null}

              {managedEditorMode === "edit" && selectedManagedService?.review?.needsReview ? (
                <div className="rounded-[24px] border border-amber-300/16 bg-amber-400/8 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-[0.72rem] uppercase tracking-[0.22em] text-amber-100/72">
                        {t("editor.cleanup.title")}
                      </p>
                      <p className="mt-2 text-sm text-white/66">
                        {t("editor.cleanup.detail")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => confirmManagedReview(selectedManagedService.id)}
                      disabled={isPending || runtimeStatus !== "ready"}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition duration-300 ${
                        isPending || runtimeStatus !== "ready"
                          ? "cursor-not-allowed border-white/8 bg-black/18 text-white/34"
                          : "border-amber-200/26 bg-amber-300/16 text-amber-50 hover:border-amber-100/36"
                      }`}
                    >
                      <ShieldCheck size={14} />
                      {t("action.markReviewed")}
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {selectedManagedService.review.reasons.map((reason) => (
                      <div
                        key={reason}
                        className="rounded-[18px] border border-white/8 bg-black/18 px-4 py-3 text-sm text-white/72"
                      >
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)]">
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.serviceMode")}
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      {managedServiceKindOptions.map((option) => {
                        const selected = managedDraft.kind === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              setManagedDraft((current) => ({
                                ...current,
                                kind: option.id,
                                icon:
                                  option.id === "docker"
                                    ? "workflow"
                                    : current.icon === "workflow"
                                      ? "server"
                                      : current.icon,
                              }))
                            }
                            className={`rounded-[18px] border px-4 py-4 text-left transition duration-300 ${
                              selected
                                ? "border-white/14 bg-black/26 text-white"
                                : "border-white/8 bg-black/14 text-white/56 hover:text-white/82"
                            }`}
                          >
                            <p className="text-sm font-semibold">{t(option.labelKey)}</p>
                            <p className="mt-2 text-xs leading-5 text-white/48">{t(option.detailKey)}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.lifecycle.title")}
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {([
                        {
                          id: "service",
                          labelKey: "editor.lifecycle.service",
                          detailKey: "editor.lifecycle.serviceDetail",
                        },
                        {
                          id: "job",
                          labelKey: "editor.lifecycle.job",
                          detailKey: "editor.lifecycle.jobDetail",
                        },
                      ] as const).map((option) => {
                        const selected = managedDraft.lifecycle === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              setManagedDraft((current) => ({
                                ...current,
                                lifecycle: option.id,
                                restartPolicy: option.id === "job" ? "manual" : current.restartPolicy,
                              }))
                            }
                            className={`rounded-[18px] border px-4 py-4 text-left transition duration-300 ${
                              selected
                                ? "border-white/14 bg-black/26 text-white"
                                : "border-white/8 bg-black/14 text-white/56 hover:text-white/82"
                            }`}
                          >
                            <p className="text-sm font-semibold">{t(option.labelKey)}</p>
                            <p className="mt-2 text-xs leading-5 text-white/48">{t(option.detailKey)}</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="block">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">{t("editor.name")}</p>
                    <input
                      className="mt-2 w-full rounded-[20px] border border-white/10 bg-[#0f141b]/94 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30"
                      value={managedDraft.name}
                      onChange={(event) =>
                        setManagedDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder={t("editor.namePlaceholder")}
                    />
                  </label>

                  <label className="block">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.description")}
                    </p>
                    <textarea
                      className="mt-2 min-h-[110px] w-full rounded-[20px] border border-white/10 bg-[#0f141b]/94 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30"
                      value={managedDraft.description}
                      onChange={(event) =>
                        setManagedDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      placeholder={t("editor.descriptionPlaceholder")}
                    />
                  </label>

                  <label className="block">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t(managedKindMeta.startLabelKey)}
                    </p>
                    <input
                      className="mt-2 w-full rounded-[20px] border border-white/10 bg-[#0f141b]/94 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-white/30"
                      value={managedDraft.startCommand}
                      onChange={(event) =>
                        setManagedDraft((current) => ({
                          ...current,
                          startCommand: event.target.value,
                        }))
                      }
                      placeholder={managedKindMeta.startPlaceholder}
                    />
                  </label>

                  <label className="block">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t(managedKindMeta.stopLabelKey)}
                    </p>
                    <input
                      className="mt-2 w-full rounded-[20px] border border-white/10 bg-[#0f141b]/94 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-white/30"
                      value={managedDraft.stopCommand}
                      onChange={(event) =>
                        setManagedDraft((current) => ({
                          ...current,
                          stopCommand: event.target.value,
                        }))
                      }
                      placeholder={t(managedKindMeta.stopPlaceholderKey)}
                    />
                  </label>

                  <label className="block">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t(managedKindMeta.restartLabelKey)}
                    </p>
                    <input
                      className="mt-2 w-full rounded-[20px] border border-white/10 bg-[#0f141b]/94 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-white/30"
                      value={managedDraft.restartCommand}
                      onChange={(event) =>
                        setManagedDraft((current) => ({
                          ...current,
                          restartCommand: event.target.value,
                        }))
                      }
                      placeholder={t(managedKindMeta.restartPlaceholderKey)}
                    />
                  </label>

                  <label className="block">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.workingDirectory")}
                    </p>
                    <input
                      className="mt-2 w-full rounded-[20px] border border-white/10 bg-[#0f141b]/94 px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-white/30"
                      value={managedDraft.cwd}
                      onChange={(event) =>
                        setManagedDraft((current) => ({
                          ...current,
                          cwd: event.target.value,
                        }))
                      }
                      placeholder="."
                    />
                  </label>

                  <div className="rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                          {t("editor.env.title")}
                        </p>
                        <p className="mt-1 text-xs text-white/44">{t("editor.env.detail")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setManagedDraft((current) => ({
                            ...current,
                            env: { ...current.env, "": "" },
                          }))
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/62 transition hover:text-white"
                      >
                        <Plus size={12} />
                        {t("editor.env.add")}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2">
                      {Object.entries(managedDraft.env).length === 0 ? (
                        <p className="text-xs text-white/34">—</p>
                      ) : (
                        Object.entries(managedDraft.env).map(([key, value], index) => (
                          <div key={`${key}-${index}`} className="flex items-center gap-2">
                            <input
                              className="w-[38%] rounded-[16px] border border-white/10 bg-black/22 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-white/30"
                              value={key}
                              placeholder={t("editor.env.keyPlaceholder")}
                              onChange={(event) =>
                                setManagedDraft((current) => {
                                  const entries = Object.entries(current.env);
                                  entries[index] = [event.target.value, entries[index][1]];
                                  return { ...current, env: Object.fromEntries(entries) };
                                })
                              }
                            />
                            <input
                              className="min-w-0 flex-1 rounded-[16px] border border-white/10 bg-black/22 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-white/30"
                              value={value}
                              placeholder={t("editor.env.valuePlaceholder")}
                              onChange={(event) =>
                                setManagedDraft((current) => ({
                                  ...current,
                                  env: { ...current.env, [key]: event.target.value },
                                }))
                              }
                            />
                            <button
                              type="button"
                              aria-label={t("editor.env.remove")}
                              onClick={() =>
                                setManagedDraft((current) => {
                                  const next = { ...current.env };
                                  delete next[key];
                                  return { ...current, env: next };
                                })
                              }
                              className="grid size-8 shrink-0 place-items-center rounded-[14px] border border-white/8 bg-black/18 text-white/50 transition hover:text-rose-300"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.modeGuidance")}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-white/60">{t(managedKindMeta.guidanceKey)}</p>
                  </div>

                  {managedDraft.lifecycle !== "job" ? (
                  <div className="rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.restartPolicy")}
                    </p>
                    <div className="mt-4 grid gap-3">
                      {[
                        {
                          id: "manual",
                          labelKey: "policy.manual" as TranslationKey,
                          detailKey: "policy.manual.detail" as TranslationKey,
                        },
                        {
                          id: "on-failure",
                          labelKey: "policy.on-failure" as TranslationKey,
                          detailKey: "policy.on-failure.detail" as TranslationKey,
                        },
                        {
                          id: "always",
                          labelKey: "policy.always" as TranslationKey,
                          detailKey: "policy.always.detail" as TranslationKey,
                        },
                      ].map((option) => {
                        const selected = managedDraft.restartPolicy === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              setManagedDraft((current) => ({
                                ...current,
                                restartPolicy: option.id as ManagedServiceDraft["restartPolicy"],
                              }))
                            }
                            className={`rounded-[18px] border px-4 py-3 text-left transition duration-300 ${
                              selected
                                ? "border-white/14 bg-black/26 text-white"
                                : "border-white/8 bg-black/14 text-white/56 hover:text-white/82"
                            }`}
                          >
                            <p className="text-sm font-semibold">{t(option.labelKey)}</p>
                            <p className="mt-2 text-xs leading-5 text-white/48">{t(option.detailKey)}</p>
                          </button>
                        );
                      })}
                    </div>

                    <label className="mt-4 block">
                      <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                        {t("editor.retryLimit")}
                      </p>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        className="mt-2 w-full rounded-[20px] border border-white/10 bg-black/18 px-4 py-3 text-sm text-white outline-none"
                        value={managedDraft.restartLimit}
                        onChange={(event) =>
                          setManagedDraft((current) => ({
                            ...current,
                            restartLimit: Number.parseInt(event.target.value, 10) || 1,
                          }))
                        }
                      />
                    </label>
                  </div>
                  ) : null}

                  <div className="rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.titleColor")}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {managedServiceColorOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setManagedDraft((current) => ({ ...current, titleColor: option.id }))
                          }
                          className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs uppercase tracking-[0.22em] transition duration-300 ${
                            managedDraft.titleColor === option.id
                              ? "border-white/16 bg-black/26 text-white"
                              : "border-white/8 bg-black/14 text-white/48 hover:text-white/76"
                          }`}
                        >
                          <span
                            className="size-3 rounded-full border border-white/10"
                            style={{ backgroundColor: managedServiceColorMap[option.id] }}
                          />
                          {t(option.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4">
                    <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                      {t("editor.cardIcon")}
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {managedServiceIconOptions.map((option) => {
                        const Icon = managedServiceIconMap[option.id];
                        const selected = managedDraft.icon === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() =>
                              setManagedDraft((current) => ({ ...current, icon: option.id }))
                            }
                            className={`flex items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition duration-300 ${
                              selected
                                ? "border-white/14 bg-black/26 text-white"
                                : "border-white/8 bg-black/14 text-white/56 hover:text-white/82"
                            }`}
                          >
                            <span className="grid size-10 place-items-center rounded-[16px] border border-white/10 bg-black/18">
                              <Icon size={18} />
                            </span>
                            <span className="text-sm font-medium">{t(option.labelKey)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/18 px-4 py-4 text-sm text-white/46">
                    {t("editor.hint")}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-white/8 pt-4">
                <ShinyButton
                  label={managedEditorMode === "create" ? t("action.createService") : t("action.saveChanges")}
                  hex={accent.rose}
                  icon={managedEditorMode === "create" ? Plus : PenSquare}
                  onClick={saveManagedDraft}
                  disabled={isPending || runtimeStatus !== "ready"}
                />
                {managedEditorMode === "create" ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedManagedService) {
                        setManagedDraft(createDraftFromManagedProcess(selectedManagedService));
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
                  >
                    {t("action.reset")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setManagedEditorOpen(false)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
                >
                  {t("action.close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  const renderPortsPage = () => (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.9fr)]">
      <div className={panelClass}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("ports.eyebrow")}</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{t("overview.bindings")}</h3>
          </div>
          <ShinyButton
            label={t("action.scan")}
            hex={accent.cyan}
            icon={Waypoints}
            subtle
            disabled={isPending}
            onClick={() => handleProcessAction("scan")}
          />
        </div>

        <div className="mt-6 overflow-x-auto rounded-[28px] border border-white/8 bg-black/18">
          {filteredPorts.length > 0 ? (
            <div className="min-w-[940px]">
              <div className="grid grid-cols-[72px_76px_minmax(0,1.1fr)_120px_110px_minmax(180px,1.45fr)] gap-4 border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.24em] text-white/38">
                <span>{t("ports.table.port")}</span>
                <span>{t("field.proto")}</span>
                <span>{t("ports.table.service")}</span>
                <span>{t("field.exposure")}</span>
                <span>{t("ports.table.status")}</span>
                <span>{t("field.target")}</span>
              </div>

              <div className="divide-y divide-white/6">
                {filteredPorts.map((port) => {
                  const isExpanded = expandedPortIds.includes(port.id);
                  const history = port.history ?? [];

                  return (
                    <div key={port.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPortIds((current) =>
                            current.includes(port.id)
                              ? current.filter((id) => id !== port.id)
                              : [...current, port.id],
                          )
                        }
                        className="grid w-full grid-cols-[72px_76px_minmax(0,1.1fr)_120px_110px_minmax(180px,1.45fr)] gap-4 px-5 py-4 text-left transition duration-300 hover:bg-white/[0.03]"
                      >
                        <p className="text-sm font-semibold text-white">{port.port}</p>
                        <p className="text-sm text-white/58 uppercase">{port.protocol}</p>
                        <div className="min-w-0">
                          <p className="break-words text-sm text-white/86">{port.service}</p>
                          <p className="text-xs text-white/38">{port.note}</p>
                        </div>
                        <p className="text-sm capitalize text-white/62">{t(exposureLabelKeys[port.exposure])}</p>
                        <p className={`text-sm font-medium capitalize ${portTextClassMap[port.status]}`}>
                          {t(portStatusLabelKeys[port.status])}
                        </p>
                        <p className="break-all text-sm text-white/46">{port.target}</p>
                      </button>

                      {isExpanded ? (
                        <div className="px-5 pb-5">
                          <div className="rounded-[20px] border border-white/8 bg-black/22 p-4">
                            <p className="text-[0.68rem] uppercase tracking-[0.22em] text-white/42">
                              {t("ports.history.title")}
                            </p>
                            {history.length === 0 ? (
                              <p className="mt-3 text-xs text-white/38">{t("ports.history.empty")}</p>
                            ) : (
                              <div className="mt-3 space-y-2">
                                {history.map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="flex flex-wrap items-center gap-3 text-xs text-white/62"
                                  >
                                    <span
                                      className={`rounded-full px-2 py-0.5 uppercase tracking-[0.16em] ${
                                        entry.event === "bound"
                                          ? "bg-emerald-400/12 text-emerald-200"
                                          : "bg-white/8 text-white/56"
                                      }`}
                                    >
                                      {t(
                                        entry.event === "bound"
                                          ? "ports.history.bound"
                                          : "ports.history.released",
                                      )}
                                    </span>
                                    <span className="font-mono text-white/72">{entry.processName}</span>
                                    <span className="text-white/34">pid {entry.pid}</span>
                                    <span className="text-white/34">
                                      {formatUnifiedLogStamp(entry.timestamp)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="px-5 py-8">
              <p className="text-sm font-semibold text-white/84">{t("ports.empty.title")}</p>
              <p className="mt-2 text-sm text-white/52">
                {t("ports.empty.detail")}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className={panelClass}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("ports.safety.eyebrow")}</p>
            <h3 className="mt-2 text-xl font-semibold text-white">{t("ports.safety.title")}</h3>
          </div>
          <div className="grid size-11 place-items-center rounded-[20px] border border-white/10 bg-black/18">
            <ShieldCheck size={20} className="text-cyan-300" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[
            [t("ports.safety.public"), `${publicPortCount}`],
            [t("ports.safety.conflicts"), `${conflictCount}`],
            [t("ports.safety.watched"), `${watchedCount}`],
            [t("ports.safety.open"), `${openPortCount}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[22px] border border-white/8 bg-black/18 px-4 py-4">
              <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/38">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {filteredPorts.filter((port) => port.status === "conflict" || port.exposure === "public")
            .length > 0 ? (
            filteredPorts
              .filter((port) => port.status === "conflict" || port.exposure === "public")
              .map((port) => (
                <div
                  key={port.id}
                  className="rounded-[22px] border border-white/8 bg-[#0f141b]/94 px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white/88">
                      {port.port} / {port.service}
                    </p>
                    <p className={`text-xs uppercase tracking-[0.22em] ${portTextClassMap[port.status]}`}>
                      {t(portStatusLabelKeys[port.status])}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-white/54">{port.note}</p>
                </div>
              ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/18 px-4 py-5 text-sm text-white/48">
              {t("ports.safety.empty")}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const renderMonitorPage = () => (
    <section className="grid gap-5">
      <div className={panelClass}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("overview.systemMonitor")}</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{t("monitor.title")}</h3>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {monitorTrendCards.length > 0 ? (
            <div className="rounded-[28px] border border-white/8 bg-black/18 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-white/38">
                    {t("monitor.trendCanvas")}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {t("monitor.rollingPressure")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {monitorWindowOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setMonitorWindow(option.id)}
                      className={`rounded-full border px-3 py-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.18em] transition duration-300 ${
                        monitorWindow === option.id
                          ? "border-white/14 bg-black/26 text-white"
                          : "border-white/8 bg-black/16 text-white/42 hover:text-white/72"
                      }`}
                    >
                      {t(option.labelKey)}
                    </button>
                  ))}
                  <Gauge size={20} className="text-cyan-300" />
                </div>
              </div>

              <div className="mt-5 grid gap-3 xl:grid-cols-3">
                {monitorTrendCards.map((series) => (
                  <PulseLineChart
                    key={series.id}
                    label={series.label}
                    valueLabel={series.displayValue ?? `${series.values[series.values.length - 1] ?? 0}%`}
                    detail={series.detail}
                    values={series.values}
                    hex={monitorMetricHexMap[series.id] ?? accent.cyan}
                    inactive={series.available === false}
                  />
                ))}
                {gpuTrendSeries ? (
                  <PulseLineChart
                    key={gpuTrendSeries.id}
                    label={gpuTrendSeries.label}
                    valueLabel={
                      gpuTrendSeries.displayValue ??
                      `${gpuTrendSeries.values[gpuTrendSeries.values.length - 1] ?? 0}%`
                    }
                    detail={gpuTrendSeries.detail}
                    values={gpuTrendSeries.values}
                    hex={monitorMetricHexMap[gpuTrendSeries.id] ?? accent.rose}
                    inactive={gpuTrendSeries.available === false}
                  />
                ) : null}
                <article
                  key="runtime-pulse"
                  className="relative overflow-hidden rounded-[24px] border border-white/8 bg-[#0f141b]/94 p-4"
                >
                  <div
                    className="pointer-events-none absolute inset-x-6 top-0 h-px"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent.amber}, transparent)` }}
                  />
                  <div className="relative flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[0.72rem] uppercase tracking-[0.22em] text-white/34">
                        {t("monitor.runtimePulse")}
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">{t("monitor.currentWaveform")}</p>
                    </div>
                    <div
                      className="rounded-full border px-3 py-1 text-[0.68rem] uppercase tracking-[0.22em]"
                      style={{
                        color: accent.amber,
                        borderColor: `${accent.amber}30`,
                        backgroundColor: `${accent.amber}12`,
                      }}
                    >
                      {t("monitor.live")}
                    </div>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-white/8 bg-black/24 px-4 py-5">
                    <SignalBars
                      values={[24, 46, 62, 71, 53, 88, 76, 68, 90, 58]}
                      className="h-40 w-full justify-between gap-2"
                      barClassName="min-w-0 flex-1"
                    />
                  </div>

                  <p className="mt-4 text-sm text-white/52">
                    {t("monitor.waveformDetail")}
                  </p>
                </article>
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/18 px-4 py-5 text-sm text-white/48">
              {t("monitor.trendEmpty")}
            </div>
          )}

          <div className="rounded-[28px] border border-white/8 bg-[#0f141b]/94 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-white/38">
                  {t("monitor.snapshotLane")}
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {t("monitor.currentPressure")}
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-xs uppercase tracking-[0.22em] text-white/58">
                {t("monitor.last24")}
              </div>
            </div>

            <div className="mt-5 grid gap-3 xl:grid-cols-2">
              {monitorMetrics.length > 0 ? (
                monitorMetrics.map((metric) => (
                  <HologramProgress
                    key={metric.id}
                    label={metric.label}
                    value={metric.value}
                    valueLabel={metric.displayValue}
                    detail={metric.detail}
                    inactive={metric.available === false}
                    hex={monitorMetricHexMap[metric.id] ?? accent.cyan}
                  />
                ))
              ) : (
                <div className="rounded-[22px] border border-dashed border-white/10 bg-black/18 px-4 py-5 text-sm text-white/48 xl:col-span-2">
                  {t("monitor.waitingSnapshot")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={panelClass}>
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("monitor.noisyServices")}</p>
          <h3 className="mt-2 text-xl font-semibold text-white">{t("monitor.topDraw")}</h3>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {busiestProcesses.length > 0 ? (
            busiestProcesses.map((process) => (
              <article
                key={process.id}
                className="rounded-[22px] border border-white/8 bg-[#0f141b]/94 px-4 py-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white/88">{process.name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/8 bg-black/18 px-2.5 py-1 text-[0.64rem] uppercase tracking-[0.2em] text-white/40">
                        {process.runtime}
                      </span>
                      <span className="rounded-full border border-white/8 bg-black/18 px-2.5 py-1 text-[0.64rem] uppercase tracking-[0.2em] text-white/40">
                        {process.group}
                      </span>
                      <span className="rounded-full border border-white/8 bg-black/18 px-2.5 py-1 text-[0.64rem] uppercase tracking-[0.2em] text-white/40">
                        {process.uptime}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusPill
                      tone={processToneMap[process.status]}
                      label={t(processStatusLabelKeys[process.status])}
                    />
                    {renderProcessOwnershipTag(process)}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                    <p className="text-[0.7rem] uppercase tracking-[0.18em] text-white/34">{t("field.cpu")}</p>
                    <p className="mt-2 font-semibold text-white">{process.cpu}%</p>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                    <p className="text-[0.7rem] uppercase tracking-[0.18em] text-white/34">{t("field.memory")}</p>
                    <p className="mt-2 font-semibold text-white">{process.memory} MB</p>
                  </div>
                  <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                    <p className="text-[0.7rem] uppercase tracking-[0.18em] text-white/34">{t("field.network")}</p>
                    <p className="mt-2 font-semibold text-white">{process.network} Mbps</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleResourceDrawExpanded(process.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
                  >
                    {expandedResourceDrawIds.includes(process.id)
                      ? t("processes.collapse")
                      : t("processes.expand")}
                    {expandedResourceDrawIds.includes(process.id) ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProcessId(process.id);
                      changeView("processes");
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
                  >
                    {t("monitor.inspect")}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
                {expandedResourceDrawIds.includes(process.id) ? (
                  <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
                    <p className="text-sm text-white/56">{process.description}</p>
                    <div className="rounded-[18px] border border-white/8 bg-black/18 px-3 py-3">
                      <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">
                        {t("field.command")}
                      </p>
                      <p className="mt-2 break-all font-mono text-sm text-white/78">
                        {process.command}
                      </p>
                      <p className="mt-3 break-all font-mono text-xs text-white/42">
                        {process.cwd}
                      </p>
                    </div>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/18 px-4 py-5 text-sm text-white/48 xl:col-span-2">
              {t("monitor.leadersEmpty")}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const renderPage = () => {
    if (runtimeStatus === "loading") {
      return renderStatePanel({
        eyebrow: t("state.loading.eyebrow"),
        title: t("state.loading.title"),
        detail: t("state.loading.detail", {
          source: t(runtimeSource.labelKey),
        }),
        hex: accent.cyan,
        icon: Terminal,
      });
    }

    if (runtimeStatus === "error") {
      return renderStatePanel({
        eyebrow: t("state.loading.eyebrow"),
        title: t("state.error.title"),
        detail: runtimeError
          ? describeError(runtimeError, "state.error.detail")
          : t("state.error.detail"),
        hex: accent.rose,
        icon: BellRing,
        actionLabel: t("action.resetSession"),
        onAction: restoreDefaultWorkspace,
      });
    }

    if (activeView === "processes") {
      return renderProcessesPage();
    }

    if (activeView === "managed") {
      return renderManagedPage();
    }

    if (activeView === "logs") {
      return renderLogsPage();
    }

    if (activeView === "ports") {
      return renderPortsPage();
    }

    if (activeView === "monitor") {
      return renderMonitorPage();
    }

    if (activeView === "terminal") {
      return <TerminalView accent={accent} />;
    }

    return renderOverview();
  };

  return (
    <div className="min-h-screen px-4 py-4 text-white sm:px-5 lg:px-6">
      <div
        className={`mewl-shell mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1680px] gap-5 ${
          sidebarCollapsed
            ? "xl:grid-cols-[112px_minmax(0,1fr)]"
            : "xl:grid-cols-[292px_minmax(0,1fr)]"
        }`}
      >
        <aside className="glass-panel relative flex overflow-hidden rounded-[34px] p-4 xl:flex-col xl:p-5">
          <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-slate-300/35 to-transparent" />

          <div className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"} gap-3`}>
            <div className="flex items-center gap-3">
              <img
                src={appIconUrl}
                alt={t("shell.appIconAlt")}
                className="size-18 rounded-[16px] border border-white/10 object-cover shadow-[0_0_32px_rgba(148,163,184,0.18)]"
              />
              {!sidebarCollapsed ? (
                <p className="text-[0.95rem] font-semibold uppercase tracking-[0.32em] text-white/56">
                  Mewl
                </p>
              ) : null}
            </div>

            {!sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="grid size-10 place-items-center rounded-[18px] border border-white/10 bg-[#0f141b]/94 text-white/62 transition duration-300 hover:text-white"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}
          </div>

          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              className="mt-4 grid size-10 place-self-center place-items-center rounded-[18px] border border-white/10 bg-[#0f141b]/94 text-white/62 transition duration-300 hover:text-white"
            >
              <ChevronRight size={18} />
            </button>
          ) : null}

          <nav className="mt-8 space-y-2">
            {viewMeta.map(({ id, labelKey, icon: Icon, hex }) => {
              const isActive = id === activeView;
              const label = t(labelKey);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => changeView(id)}
                  aria-label={label}
                  className={`flex w-full items-center ${sidebarCollapsed ? "justify-center px-0" : "justify-between px-4"} rounded-[22px] border py-3 text-left transition duration-300 ${
                    isActive
                      ? "border-white/12 bg-[#11161d]/94 text-white"
                      : "border-transparent bg-[#0e1319]/78 text-white/62 hover:border-white/10 hover:bg-[#11161d]/90 hover:text-white"
                  }`}
                  style={
                    isActive
                      ? ({
                          boxShadow: `0 20px 56px -36px ${hex}`,
                        } satisfies CSSProperties)
                      : undefined
                  }
                >
                  <span className={`flex items-center ${sidebarCollapsed ? "" : "gap-3"}`}>
                    <span
                      className="grid size-10 place-items-center rounded-2xl border border-white/8 bg-black/18"
                      style={
                        isActive
                          ? ({
                              color: hex,
                              boxShadow: `0 0 24px ${hex}24`,
                            } satisfies CSSProperties)
                          : undefined
                      }
                    >
                      <Icon size={18} />
                    </span>
                    {!sidebarCollapsed ? <span className="text-sm font-medium">{label}</span> : null}
                  </span>
                  {isActive && !sidebarCollapsed ? <ArrowUpRight size={16} /> : null}
                </button>
              );
            })}
          </nav>

          <div
            className={`mt-8 rounded-[28px] border border-white/8 bg-[#0f141b]/94 ${
              sidebarCollapsed ? "p-3" : "p-4"
            }`}
            style={{ boxShadow: "0 24px 80px -48px rgba(34, 211, 238, 0.4)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                {!sidebarCollapsed ? (
                  <p className="text-xs uppercase tracking-[0.24em] text-white/40">{t("shell.hostHealth")}</p>
                ) : null}
                <p className={`font-semibold text-white ${sidebarCollapsed ? "mt-1 text-2xl" : "mt-3 text-3xl"}`}>
                  {100 - degradedCount * 7}%
                </p>
              </div>
              {!sidebarCollapsed ? (
                <StatusPill tone={degradedCount > 0 ? "warning" : "online"} label={t("filters.watching")} />
              ) : null}
            </div>

            <div className="mt-4 rounded-[24px] border border-white/8 bg-black/18 px-3 py-4">
              <SignalBars
                values={[34, 48, 62, 56, 72, 68, 84, 74]}
                className="w-full justify-between gap-1.5"
                barClassName="min-w-0 flex-1"
              />
            </div>

            <div className={`mt-4 grid gap-3 ${sidebarCollapsed ? "grid-cols-1" : "grid-cols-2"}`}>
              {[
                [t("field.cpu"), `${hostCpu}%`, ""],
                ["RAM", `${hostMemory}%`, ""],
                ["Disk", `${hostDisk}%`, ""],
                [t("field.network"), `${hostNetwork}%`, ""],
                [
                  "GPU",
                  hostGpuMetric?.available === false
                    ? t("monitor.gpuUnavailable")
                    : hostGpuMetric?.displayValue ?? `${hostGpu}%`,
                  "col-span-2",
                ],
              ].map(([label, value, className]) => (
                <div
                  key={label}
                  className={`rounded-[20px] border border-white/8 bg-black/18 px-3 py-3 text-sm ${className}`}
                >
                  <p className="text-[0.68rem] uppercase tracking-[0.18em] text-white/34">{label}</p>
                  <p className="mt-2 font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>

        </aside>

        <main className="flex min-w-0 flex-col gap-5">
          <section className={`${panelClass} relative z-20 p-4 sm:p-5`}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[280px] flex-1">
                <CandyInput
                  value={query}
                  onChange={setQuery}
                  hex={accent.rose}
                  placeholder={t("shell.searchPlaceholder")}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <ShinyButton
                  label={t("action.scan")}
                  hex={accent.cyan}
                  icon={Waypoints}
                  subtle
                  disabled={isPending || runtimeStatus !== "ready"}
                  onClick={() => handleProcessAction("scan")}
                />
              </div>

              <StatusPill
                tone={runtimeIndicatorTone}
                label={
                  runtimeStatus === "ready"
                    ? runtimeSource.badgeLabelKey
                      ? t(runtimeSource.badgeLabelKey)
                      : ""
                    : runtimeStatus === "error"
                      ? t("shell.status.sourceError")
                      : t("shell.status.hydrating")
                }
              />

              {/* Language toggle. Shows the language you would switch to, which is
                  the common convention for compact in-app switchers. */}
              {/* 语言切换按钮。显示将要切换到的语言，这是应用内紧凑切换器的常见惯例。 */}
              <button
                type="button"
                onClick={() => setLocale(locale === "en" ? "zh" : "en")}
                aria-label={t("language.switch")}
                title={t("language.switch")}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0f141b]/94 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/72 transition duration-300 hover:border-white/18 hover:text-white"
              >
                <Languages size={16} />
                {locale === "en" ? "中文" : "EN"}
              </button>

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label={t("settings.title")}
                title={t("settings.title")}
                className="grid size-12 place-items-center rounded-[20px] border border-white/10 bg-[#0f141b]/94 text-white/72 transition duration-300 hover:border-white/18 hover:text-white"
              >
                <Settings size={17} />
              </button>

              <div className="relative ml-auto">
                <button
                  type="button"
                  onClick={() => setAlertsOpen((open) => !open)}
                  className="relative grid size-12 place-items-center rounded-[20px] border border-white/10 bg-[#0f141b]/94 transition duration-300 hover:border-white/18"
                  style={{
                    boxShadow: alertsOpen
                      ? `0 18px 50px -30px ${accent.amber}`
                      : "0 18px 50px -42px rgba(0, 0, 0, 0.95)",
                  }}
                >
                  <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.9)]" />
                  <BellRing
                    size={18}
                    style={{ color: alertsOpen ? accent.amber : "rgba(255,255,255,0.72)" }}
                  />
                </button>

                {alertsOpen ? (
                  <div className="absolute right-0 top-[calc(100%+0.85rem)] z-50 w-[420px] max-w-[calc(100vw-2rem)] rounded-[26px] border border-white/8 bg-[#0c1015]/96 p-3 shadow-[0_34px_90px_-42px_rgba(0,0,0,0.96)] backdrop-blur-2xl">
                    {renderAlertFeed()}
                  </div>
                ) : null}
              </div>
            </div>

            {activeView === "processes" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {statusFilterOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setStatusFilter(option.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.22em] transition duration-300 ${
                      statusFilter === option.id
                        ? "border-white/12 bg-[#121821] text-white"
                        : "border-white/8 bg-black/18 text-white/42 hover:text-white/72"
                    }`}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <div key={`${runtimeStatus}-${activeView}`} className="flex flex-col gap-5">
            {renderPage()}
          </div>
        </main>
      </div>
      {renderManagedEditorModal()}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        accent={accent}
        onMessage={setCommandState}
      />
    </div>
  );
}

export default App;
