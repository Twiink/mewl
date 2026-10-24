import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import { useI18n } from "../i18n";
import { getHostBridge } from "../runtime/provider";
import type { MewlSettings, UpdateStatus } from "../data/runtime";

const numberFieldClass =
  "w-24 rounded-[18px] border border-white/10 bg-[#0f141b]/94 px-4 py-2 text-sm text-white outline-none";

function SettingsRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[22px] border border-white/8 bg-black/14 px-4 py-3">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm font-semibold text-white/86">{title}</p>
        <p className="mt-1 text-xs text-white/42">{detail}</p>
      </div>
      {children}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  accent,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-7 w-12 rounded-full border transition duration-300"
      style={{
        backgroundColor: checked ? `${accent}30` : "rgba(0,0,0,0.3)",
        borderColor: checked ? `${accent}55` : "rgba(255,255,255,0.12)",
      }}
    >
      <span
        className="absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-all duration-300"
        style={{
          left: checked ? "26px" : "3px",
          backgroundColor: checked ? accent : "rgba(255,255,255,0.4)",
        }}
      />
    </button>
  );
}

export function SettingsModal({
  open,
  onClose,
  accent,
  onMessage,
}: {
  open: boolean;
  onClose: () => void;
  accent: { rose: string; cyan: string };
  onMessage: (message: string) => void;
}) {
  const { t } = useI18n();
  const bridge = getHostBridge();
  const [settings, setSettings] = useState<MewlSettings | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    void bridge
      ?.getSettings?.()
      .then((loaded) => {
        if (!cancelled) {
          setSettings(loaded);
        }
      })
      .catch(() => setSettings(null));

    void bridge
      ?.getUpdateStatus?.()
      .then((status) => {
        if (!cancelled) {
          setUpdateStatus(status);
        }
      })
      .catch(() => undefined);

    const unsubscribe = bridge?.subscribeToUpdateStatus?.((status) => {
      setUpdateStatus(status);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [open, bridge]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const persist = async (updates: Partial<MewlSettings>) => {
    try {
      const saved = await bridge?.updateSettings?.(updates);
      if (saved) {
        setSettings(saved);
        onMessage(t("settings.saved"));
      }
    } catch (_error) {
      onMessage(t("settings.saveFailed"));
    }
  };

  const renderUpdateBody = () => {
    if (!bridge?.checkForUpdates) {
      return <p className="text-xs text-white/42">{t("settings.desktopOnly")}</p>;
    }

    if (updateStatus?.supported === false || updateStatus?.status === "unsupported") {
      return <p className="text-xs text-white/52">{t("settings.updateUnsupported")}</p>;
    }

    const status = updateStatus?.status ?? "idle";
    const actionButton = (() => {
      if (status === "downloaded") {
        return (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                bridge?.installUpdate?.();
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-black"
            style={{ backgroundColor: accent.rose }}
          >
            {t("settings.installUpdate")}
          </button>
        );
      }

      if (status === "available") {
        return (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const next = await bridge?.downloadUpdate?.();
                if (next) {
                  setUpdateStatus(next);
                }
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-full border border-white/12 bg-black/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/80"
          >
            {t("settings.downloadUpdate")}
          </button>
        );
      }

      return (
        <button
          type="button"
          disabled={busy || status === "checking" || status === "downloading"}
          onClick={async () => {
            setBusy(true);
            try {
              const next = await bridge?.checkForUpdates?.();
              if (next) {
                setUpdateStatus(next);
              }
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/80 disabled:opacity-50"
        >
          <RefreshCw size={13} className={status === "checking" ? "animate-spin" : ""} />
          {t("settings.checkUpdates")}
        </button>
      );
    })();

    const statusLine = (() => {
      switch (status) {
        case "checking":
          return t("settings.updateChecking");
        case "available":
          return t("settings.updateAvailable", { version: updateStatus?.version ?? "" });
        case "not-available":
          return t("settings.updateNotAvailable");
        case "downloading":
          return t("settings.updateDownloading", {
            percent: String(updateStatus?.progress?.percent ?? 0),
          });
        case "downloaded":
          return t("settings.updateDownloaded", { version: updateStatus?.version ?? "" });
        case "error":
          return t("settings.updateError", { message: updateStatus?.message ?? "" });
        default:
          return t("settings.updateIdle");
      }
    })();

    return (
      <div className="grid gap-3">
        {actionButton}
        <p className="text-xs text-white/52">{statusLine}</p>
        {status === "downloading" && updateStatus?.progress ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${updateStatus.progress.percent}%`,
                backgroundColor: accent.cyan,
              }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-[#05070bcc]/90 px-4 py-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="glass-panel max-h-[calc(100vh-3rem)] w-full max-w-[680px] overflow-hidden rounded-[34px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-5 sm:px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">
              {t("settings.title")}
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{t("settings.title")}</h3>
            <p className="mt-1 text-sm text-white/52">{t("settings.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("settings.closeAria")}
            className="grid size-10 place-items-center rounded-[18px] border border-white/10 bg-black/18 text-white/70 transition duration-300 hover:border-white/18 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-13rem)] overflow-y-auto px-5 py-5 sm:px-6">
          {!bridge?.getSettings ? (
            <p className="text-sm text-white/52">{t("settings.desktopOnly")}</p>
          ) : settings ? (
            <div className="grid gap-6">
              <section className="grid gap-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white/42">
                  {t("settings.section.general")}
                </p>
                <SettingsRow
                  title={t("settings.showWindowOnStartup")}
                  detail={t("settings.showWindowOnStartupDetail")}
                >
                  <ToggleSwitch
                    checked={settings.showWindowOnStartup}
                    onChange={(next) => {
                      setSettings({ ...settings, showWindowOnStartup: next });
                      void persist({ showWindowOnStartup: next });
                    }}
                    accent={accent.rose}
                  />
                </SettingsRow>
                <SettingsRow
                  title={t("settings.closeToTray")}
                  detail={t("settings.closeToTrayDetail")}
                >
                  <ToggleSwitch
                    checked={settings.closeToTray}
                    onChange={(next) => {
                      setSettings({ ...settings, closeToTray: next });
                      void persist({ closeToTray: next });
                    }}
                    accent={accent.rose}
                  />
                </SettingsRow>
                <SettingsRow title={t("settings.openLogs")} detail={settings.logRetentionDays + "d"}>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await bridge?.openLogsDirectory?.();
                      if (!ok) {
                        onMessage(t("settings.openLogsFailed"));
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/80"
                  >
                    <FolderOpen size={13} />
                    {t("settings.openLogs")}
                  </button>
                </SettingsRow>
              </section>

              <section className="grid gap-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white/42">
                  {t("settings.section.retention")}
                </p>
                <SettingsRow
                  title={t("settings.logRetentionDays")}
                  detail={t("settings.logRetentionDaysDetail")}
                >
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={numberFieldClass}
                    value={settings.logRetentionDays}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        logRetentionDays: Number(event.target.value) || 7,
                      })
                    }
                    onBlur={(event) => void persist({ logRetentionDays: Number(event.target.value) || 7 })}
                  />
                </SettingsRow>
                <SettingsRow
                  title={t("settings.historyRetentionDays")}
                  detail={t("settings.historyRetentionDaysDetail")}
                >
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className={numberFieldClass}
                    value={settings.historyRetentionDays}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        historyRetentionDays: Number(event.target.value) || 7,
                      })
                    }
                    onBlur={(event) =>
                      void persist({ historyRetentionDays: Number(event.target.value) || 7 })
                    }
                  />
                </SettingsRow>
              </section>

              <section className="grid gap-3">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.24em] text-white/42">
                  {t("settings.section.updates")}
                </p>
                <SettingsRow
                  title={t("settings.autoCheckUpdates")}
                  detail={t("settings.autoCheckUpdatesDetail")}
                >
                  <ToggleSwitch
                    checked={settings.autoCheckUpdates}
                    onChange={(next) => {
                      setSettings({ ...settings, autoCheckUpdates: next });
                      void persist({ autoCheckUpdates: next });
                    }}
                    accent={accent.cyan}
                  />
                </SettingsRow>
                {renderUpdateBody()}
              </section>
            </div>
          ) : (
            <p className="text-sm text-white/52">{t("settings.desktopOnly")}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
