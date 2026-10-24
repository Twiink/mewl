import type { TranslationKey } from "../i18n/en";
import { MewlLocalizedError } from "../i18n/localized-error";
import type { Locale } from "../i18n/types";
import {
  type ManagedServiceDraft,
  type ManagedServiceUpdate,
  type RuntimeSnapshot,
  type UnifiedLogEvent,
} from "../data/runtime";

export type HostLayerChoice = "electron";

export type RuntimeSourceId = "desktop-required" | "electron";

export type RuntimeCapability =
  | "process-control"
  | "port-discovery"
  | "host-metrics"
  | "secure-command-execution";

// Display strings on the descriptor are translation keys, resolved by the
// renderer through t(), so the locale switcher also re-renders runtime chrome.
// 描述符上的展示字符串都是翻译键，由渲染层通过 t() 解析，
// 因此切换语言后运行时相关的界面文案也会随之刷新。
export type RuntimeSourceDescriptor = {
  id: RuntimeSourceId;
  labelKey: TranslationKey;
  badgeLabelKey: TranslationKey | null;
  detailKey: TranslationKey;
  hostLayer: HostLayerChoice;
  availability: "active" | "unavailable";
  capabilities: RuntimeCapability[];
};

export type MewlHostBridge = {
  hydrateRuntimeSnapshot: () => Promise<RuntimeSnapshot>;
  setLocale?: (locale: Locale) => Promise<void>;
  subscribeToLogs?: (listener: (events: UnifiedLogEvent[]) => void) => () => void;
  performProcessAction?: (
    action: "start" | "stop" | "restart" | "scan" | "kill",
    processId: string,
  ) => Promise<RuntimeActionResult>;
  updateManagedService?: (
    processId: string,
    updates: ManagedServiceUpdate,
  ) => Promise<RuntimeActionResult>;
  createManagedService?: (service: ManagedServiceDraft) => Promise<RuntimeActionResult>;
  removeManagedService?: (processId: string) => Promise<RuntimeActionResult>;
  applyAutomationRule?: (ruleId: string, enabled: boolean) => Promise<RuntimeActionResult>;
};

export type RuntimeActionResult = {
  snapshot: RuntimeSnapshot;
  message: string;
};

// Design notes for the chosen host layer. These strings are internal
// documentation, not rendered UI, so they stay English-only.
// 所选宿主层的设计说明。这些字符串属于内部文档而非渲染 UI，因此保持纯英文。
export const chosenHostLayer = {
  id: "electron" as const,
  label: "Electron",
  summary:
    "Electron is the chosen native host for Mewl so the desktop shell, process control, and bridge contract can stay in the TypeScript stack.",
  rationale: [
    "The current product is already a React + TypeScript + Vite app, so Electron keeps the renderer and native bridge in one language and delivery pipeline.",
    "Mewl needs direct access to process spawning, termination, port inspection, and host telemetry, which maps naturally to Electron's main process.",
    "Electron's preload plus contextBridge model gives the app a secure seam for exposing only the runtime APIs the renderer needs.",
  ],
  implementationNotes: [
    "Run process control, port discovery, and machine telemetry in the Electron main process.",
    "Expose a narrow preload API to the renderer instead of leaking Node primitives into the UI.",
    "Keep the renderer contract aligned with RuntimeSnapshot so the UI only boots when the Electron bridge is available.",
  ],
};

function hasWindowObject(): boolean {
  return typeof window !== "undefined";
}

export function getHostBridge(): MewlHostBridge | null {
  if (!hasWindowObject()) {
    return null;
  }

  return window.mewlHost ?? null;
}

export function getRuntimeSourceDescriptor(): RuntimeSourceDescriptor {
  const bridge = getHostBridge();

  if (bridge) {
    return {
      id: "electron",
      labelKey: "runtime.electron.label",
      badgeLabelKey: null,
      detailKey: "runtime.electron.detail",
      hostLayer: chosenHostLayer.id,
      availability: "active",
      capabilities: [
        "process-control",
        "port-discovery",
        "host-metrics",
        "secure-command-execution",
      ],
    };
  }

  return {
    id: "desktop-required",
    labelKey: "runtime.desktopRequired.label",
    badgeLabelKey: "runtime.desktopRequired.badge",
    detailKey: "runtime.desktopRequired.detail",
    hostLayer: chosenHostLayer.id,
    availability: "unavailable",
    capabilities: [],
  };
}

export async function hydrateRuntimeSnapshot(): Promise<RuntimeSnapshot> {
  const bridge = getHostBridge();

  if (bridge) {
    return bridge.hydrateRuntimeSnapshot();
  }

  // Thrown before any React context exists, so the error carries a key that
  // App resolves through t() when it renders the failure panel.
  // 该错误在 React 上下文就绪之前抛出，因此只携带翻译键，
  // 由 App 在渲染失败面板时通过 t() 解析。
  throw new MewlLocalizedError("error.bridgeRequired");
}
