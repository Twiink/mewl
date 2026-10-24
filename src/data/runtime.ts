export type WorkspaceView =
  | "overview"
  | "processes"
  | "managed"
  | "logs"
  | "ports"
  | "monitor"
  | "terminal";

export type ProcessStatus =
  | "running"
  | "starting"
  | "degraded"
  | "stopped"
  | "completed"
  | "failed";

export type PortStatus = "bound" | "booting" | "standby" | "conflict";

export type AlertSeverity = "info" | "warning" | "critical";

export type ProcessLogLevel = "info" | "debug" | "warning" | "error";

export type ProcessLogEntry = {
  id: string;
  stamp: string;
  timestamp?: string;
  level: ProcessLogLevel;
  text: string;
};

export type ProcessLogs = {
  stdout: ProcessLogEntry[];
  stderr: ProcessLogEntry[];
};

export type ManagedServiceColor = "default" | "rose" | "purple" | "cyan" | "green" | "amber";

export type ManagedServiceIcon =
  | "server"
  | "terminal"
  | "globe"
  | "database"
  | "bot"
  | "workflow"
  | "sparkles";

export type ManagedServiceKind = "command" | "script" | "docker";

export type ManagedServiceReview = {
  needsReview: boolean;
  source: "legacy-config";
  // reasons is already localized for display by the main process. reasonKeys
  // are the canonical (locale-independent) template keys behind those reasons,
  // persisted so stored state never churns when the UI language changes.
  // reasons 已由主进程按展示语言本地化。reasonKeys 是背后与语言无关的规范
  // 模板键，随状态持久化，保证切换界面语言时不会引起存储内容变动。
  reasons: string[];
  reasonKeys?: string[];
};

export type RestartPolicy = "manual" | "on-failure" | "always";

export type AutomationHistoryOutcome = "success" | "warning" | "error";

export type AutomationHistoryEntry = {
  id: string;
  stamp: string;
  title: string;
  detail: string;
  outcome: AutomationHistoryOutcome;
  serviceId?: string;
  serviceName?: string;
  source: "manual" | "runtime" | "policy" | "profile";
};

export type ManagedServiceLifecycle = "service" | "job";

export type ManagedProcess = {
  id: string;
  name: string;
  group: string;
  description: string;
  command: string;
  cwd: string;
  runtime: string;
  kind: ManagedServiceKind;
  lifecycle: ManagedServiceLifecycle;
  startCommand?: string;
  stopCommand?: string | null;
  restartCommand?: string | null;
  status: ProcessStatus;
  pid: number | null;
  ports: number[];
  cpu: number;
  memory: number;
  network: number;
  uptime: string;
  restarts: number;
  lastExit: string;
  lastRunExit?: number | null;
  runCount?: number;
  lastHeartbeat: string;
  autoStart: boolean;
  watchPorts: boolean;
  restartPolicy: RestartPolicy;
  restartLimit: number;
  managed: boolean;
  env?: Record<string, string>;
  titleColor?: ManagedServiceColor;
  icon?: ManagedServiceIcon;
  review?: ManagedServiceReview | null;
  logs: ProcessLogs;
};

export type ManagedServiceDraft = {
  name: string;
  description: string;
  kind: ManagedServiceKind;
  lifecycle: ManagedServiceLifecycle;
  startCommand: string;
  stopCommand: string;
  restartCommand: string;
  cwd: string;
  autoStart: boolean;
  watchPorts: boolean;
  restartPolicy: RestartPolicy;
  restartLimit: number;
  env: Record<string, string>;
  titleColor: ManagedServiceColor;
  icon: ManagedServiceIcon;
};

export type ManagedServiceUpdate = Partial<ManagedServiceDraft> & {
  clearReview?: boolean;
};

export type PortHistoryEvent = {
  id: string;
  timestamp: string;
  event: "bound" | "released";
  port: number;
  protocol: string;
  pid: number;
  processName: string;
};

export type PortBinding = {
  id: string;
  port: number;
  protocol: string;
  serviceId: string;
  service: string;
  target: string;
  exposure: "public" | "local" | "internal";
  status: PortStatus;
  history?: PortHistoryEvent[];
  note: string;
};

export type AlertRecord = {
  id: string;
  title: string;
  detail: string;
  severity: AlertSeverity;
  stamp: string;
  serviceId?: string;
  serviceName?: string;
  category?: "runtime" | "ports" | "automation" | "resources";
};

export type MonitorMetric = {
  id: string;
  label: string;
  value: number;
  detail: string;
  displayValue?: string;
  available?: boolean;
};

export type MonitorHistorySeries = {
  id: string;
  label: string;
  detail: string;
  values: number[];
  displayValue?: string;
  available?: boolean;
};

export type AutomationRule = {
  id: string;
  title: string;
  detail: string;
  cadence: string;
  enabled: boolean;
};

export type UnifiedLogLevel =
  | "fatal"
  | "error"
  | "warn"
  | "log"
  | "info"
  | "success"
  | "debug"
  | "trace";

export type UnifiedLogCategory =
  | "managed-stdout"
  | "managed-stderr"
  | "container"
  | "automation"
  | "alert"
  | "internal"
  | "system";

export type UnifiedLogEvent = {
  id: string;
  timestamp: string;
  level: UnifiedLogLevel;
  source: string;
  sourceLabel: string;
  category: UnifiedLogCategory;
  message: string;
  serviceId?: string;
  serviceName?: string;
  stream?: "stdout" | "stderr" | "system";
};

export type RuntimeSnapshot = {
  processes: ManagedProcess[];
  ports: PortBinding[];
  alerts: AlertRecord[];
  monitorMetrics: MonitorMetric[];
  monitorHistory: MonitorHistorySeries[];
  automationRules: AutomationRule[];
  automationHistory: AutomationHistoryEntry[];
  logs: UnifiedLogEvent[];
};

export type MonitorWindow = "15m" | "1h" | "24h" | "7d";

export type MewlSettings = {
  showWindowOnStartup: boolean;
  closeToTray: boolean;
  logRetentionDays: number;
  historyRetentionDays: number;
  autoCheckUpdates: boolean;
};

export type TerminalSessionInfo = {
  sessionId: string;
  pid: number;
  name: string;
  cwd?: string;
  command?: string | null;
  createdAt?: number;
};

export type TerminalStreamPayload =
  | { type: "data"; sessionId: string; data: string }
  | { type: "exit"; sessionId: string; exitCode: number | null; killed?: boolean };

export type UpdateProgress = {
  percent: number;
  transferred: number;
  total: number;
};

export type UpdateStatus = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error"
    | "unsupported";
  version?: string | null;
  message?: string | null;
  progress?: UpdateProgress | null;
  supported?: boolean;
};
