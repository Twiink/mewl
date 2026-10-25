import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Plus, Square, TerminalSquare } from "lucide-react";
import { useI18n } from "../i18n";
import { getHostBridge } from "../runtime/provider";
import type { TerminalSessionInfo } from "../data/runtime";

// Local session bookkeeping: the bridge keeps the authoritative PTY map, the
// view only tracks what it has rendered tabs for and which tab is focused.
// 本地会话簿记：桥接侧持有权威的 PTY 表，视图只跟踪已渲染标签的会话
// 与当前聚焦的标签。
type ViewSession = TerminalSessionInfo & { closed: boolean };

// One xterm instance is shared across tabs, so each session keeps its own
// scrollback here and replays it whenever its tab becomes active.
// 多标签共享一个 xterm 实例，因此每个会话保留自己的回滚缓冲，
// 标签激活时重放到终端。
const scrollbackLimitChars = 128 * 1024;

const terminalTheme = {
  background: "#0f141b",
  foreground: "#e6e1d7",
  cursor: "#fb7185",
  cursorAccent: "#0f141b",
  selectionBackground: "#fb718544",
  black: "#0f141b",
  red: "#fb7185",
  green: "#6ee7b7",
  yellow: "#fbbf24",
  blue: "#67e8f9",
  magenta: "#c084fc",
  cyan: "#67e8f9",
  white: "#e6e1d7",
};

export function TerminalView({ accent }: { accent: { rose: string; cyan: string } }) {
  const { t } = useI18n();
  const bridge = getHostBridge();
  const [sessions, setSessions] = useState<ViewSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [cwdInput, setCwdInput] = useState("");
  const [commandInput, setCommandInput] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [lastMessage, setLastMessage] = useState("");

  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionsRef = useRef<ViewSession[]>([]);
  const buffersRef = useRef<Map<string, string>>(new Map());
  const activeRef = useRef("");
  const disposedRef = useRef(false);

  sessionsRef.current = sessions;
  activeRef.current = activeSessionId;

  const rememberBufferData = useCallback((sessionId: string, data: string) => {
    const buffers = buffersRef.current;
    const next = (buffers.get(sessionId) ?? "") + data;
    buffers.set(sessionId, next.length > scrollbackLimitChars ? next.slice(-scrollbackLimitChars) : next);
  }, []);

  const replaySessionBuffer = useCallback((sessionId: string) => {
    const term = terminalRef.current;
    if (!term || !sessionId) {
      return;
    }

    term.reset();
    const buffer = buffersRef.current.get(sessionId);
    if (buffer) {
      term.write(buffer);
    }
  }, []);

  const syncActiveSize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const term = terminalRef.current;
    if (!fitAddon || !term || !activeRef.current) {
      return;
    }

    try {
      fitAddon.fit();
      bridge?.resizeTerminal?.(activeRef.current, term.cols, term.rows);
    } catch (_error) {
      // Transient zero-size layouts are skipped until the panel settles.
      // 面板尺寸未稳定时跳过偶发的零尺寸布局。
    }
  }, [bridge]);

  const ensureTerminal = useCallback(() => {
    if (terminalRef.current || typeof window === "undefined") {
      return terminalRef.current;
    }

    void import("@xterm/xterm").then(({ Terminal: XTerm }) => {
      if (disposedRef.current || !hostRef.current) {
        return;
      }

      const term = new XTerm({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 13,
        theme: terminalTheme,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(hostRef.current);
      try {
        fitAddon.fit();
      } catch (_error) {
        // The host may not have a measurable layout on the first frame.
        // 宿主元素首帧可能还没有可测量的布局。
      }

      term.onData((data) => {
        if (activeRef.current) {
          bridge?.writeTerminal?.(activeRef.current, data);
        }
      });

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      replaySessionBuffer(activeRef.current);
      syncActiveSize();
      term.focus();
    });

    return null;
  }, [bridge, replaySessionBuffer, syncActiveSize]);

  useEffect(() => {
    // The terminal host is a single persistent element reused across tab
    // switches; xterm sessions push bytes through the bridge by sessionId.
    // 终端宿主是跨标签切换复用的单一持久元素；xterm 会话按 sessionId
    // 经桥接推送字节。
    disposedRef.current = false;
    ensureTerminal();

    // Sessions created elsewhere (the "run in terminal" launcher, or before
    // the view was mounted) live in the bridge's authoritative map; adopt
    // them on mount so they get a visible tab.
    // 在别处创建的会话（“在终端中运行”入口或视图挂载前）存于桥接侧的
    // 权威表；挂载时收编它们，使其拥有可见标签。
    let adoptionCancelled = false;
    void bridge?.listTerminalSessions?.().then((existing) => {
      if (adoptionCancelled || !existing?.length) {
        return;
      }

      setSessions((current) => {
        const known = new Set(current.map((session) => session.sessionId));
        const adopted = existing
          .filter((session) => !known.has(session.sessionId))
          .map((session) => ({ ...session, closed: false }));
        return adopted.length > 0 ? [...current, ...adopted] : current;
      });
      setActiveSessionId((current) => current || existing[existing.length - 1]?.sessionId || "");
    });

    const unsubscribe = bridge?.subscribeToTerminal?.({
      onData: (payload) => {
        if (payload.type !== "data") {
          return;
        }

        rememberBufferData(payload.sessionId, payload.data);
        if (payload.sessionId === activeRef.current) {
          terminalRef.current?.write(payload.data);
        }
      },
      onExit: (payload) => {
        if (payload.type !== "exit") {
          return;
        }

        buffersRef.current.delete(payload.sessionId);
        setSessions((current) =>
          current.map((session) =>
            session.sessionId === payload.sessionId ? { ...session, closed: true } : session,
          ),
        );
        setLastMessage(
          payload.killed
            ? t("terminal.sessionKilled")
            : t("terminal.sessionClosed", { code: payload.exitCode ?? "-" }),
        );
      },
    });

    return () => {
      adoptionCancelled = true;
      disposedRef.current = true;
      unsubscribe?.();
      // xterm owns its render loop and addons; dispose() tears both down so
      // remounting the view does not leak one instance per mount.
      // xterm 持有自己的渲染循环与插件；dispose() 一并释放，
      // 避免每次重挂载泄漏一个实例。
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [bridge, ensureTerminal, rememberBufferData, t]);

  // Tab activation swaps the shared xterm onto the session's replayed buffer
  // and re-fits the PTY, covering both user switches and adopted sessions.
  // 标签激活时把共享 xterm 切换到该会话的回放缓冲并重新适配 PTY，
  // 同时覆盖用户切换与收编的会话。
  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    replaySessionBuffer(activeSessionId);
    syncActiveSize();
    terminalRef.current?.focus();
  }, [activeSessionId, replaySessionBuffer, syncActiveSize]);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => syncActiveSize());

    if (hostRef.current) {
      resizeObserver.observe(hostRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [syncActiveSize]);

  const describeCreateError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("terminal-session-limit")) {
        return t("terminal.limitReached");
      }
      if (message.includes("terminal-cwd-invalid")) {
        return t("terminal.cwdInvalid");
      }
      return t("terminal.createFailed");
    },
    [t],
  );

  const createSession = async (options?: { command?: string; name?: string }) => {
    if (!bridge?.createTerminalSession) {
      setLastMessage(t("terminal.desktopOnly"));
      return;
    }

    try {
      const created = await bridge.createTerminalSession({
        cwd: cwdInput.trim() || undefined,
        cols: terminalRef.current?.cols ?? 80,
        rows: terminalRef.current?.rows ?? 24,
        command: options?.command,
        name: options?.name,
      });

      buffersRef.current.set(created.sessionId, "");
      setSessions((current) => [...current, { ...created, closed: false }]);
      setActiveSessionId(created.sessionId);
      setComposerOpen(false);
      setLastMessage("");
      terminalRef.current?.focus();
    } catch (error) {
      setLastMessage(describeCreateError(error));
    }
  };

  const closeSession = async (sessionId: string) => {
    try {
      await bridge?.killTerminalSession?.(sessionId);
    } catch (_error) {
      setLastMessage(t("terminal.killFailed"));
      return;
    }

    buffersRef.current.delete(sessionId);
    setSessions((current) => current.filter((session) => session.sessionId !== sessionId));
    if (activeRef.current === sessionId) {
      const remaining = sessionsRef.current.filter((session) => session.sessionId !== sessionId);
      const nextActive = remaining[remaining.length - 1]?.sessionId ?? "";
      setActiveSessionId(nextActive);
      if (!nextActive) {
        terminalRef.current?.reset();
      }
    }
  };

  const openSessions = useMemo(() => sessions.filter((session) => !session.closed), [sessions]);

  return (
    <section className="grid gap-5">
      <div className="glass-panel rounded-[34px] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/42">{t("terminal.title")}</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{t("terminal.title")}</h3>
            <p className="mt-1 text-sm text-white/52">{t("terminal.subtitle")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setComposerOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/72 transition duration-300 hover:border-white/18 hover:text-white"
            >
              <Plus size={14} />
              {t("terminal.newSession")}
            </button>
          </div>
        </div>

        {composerOpen ? (
          <div className="mt-5 grid gap-3 rounded-[24px] border border-white/10 bg-black/16 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="grid gap-1">
              <span className="text-[0.68rem] uppercase tracking-[0.22em] text-white/42">
                {t("terminal.cwdLabel")}
              </span>
              <input
                className="rounded-[18px] border border-white/10 bg-[#0f141b]/94 px-4 py-2 text-sm text-white outline-none placeholder:text-white/30"
                value={cwdInput}
                onChange={(event) => setCwdInput(event.target.value)}
                placeholder={t("terminal.cwdPlaceholder")}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-[0.68rem] uppercase tracking-[0.22em] text-white/42">
                {t("terminal.commandTag")}
              </span>
              <input
                className="rounded-[18px] border border-white/10 bg-[#0f141b]/94 px-4 py-2 text-sm text-white outline-none placeholder:text-white/30"
                value={commandInput}
                onChange={(event) => setCommandInput(event.target.value)}
                placeholder="npm run dev"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                void createSession({ command: commandInput.trim() || undefined })
              }
              className="self-end rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-black"
              style={{ backgroundColor: accent.rose }}
            >
              {t("terminal.newSession")}
            </button>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition duration-300 ${
                session.sessionId === activeSessionId
                  ? "border-white/14 bg-black/26 text-white"
                  : "border-white/8 bg-black/18 text-white/42 hover:text-white/72"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveSessionId(session.sessionId)}
                className="inline-flex items-center gap-2"
              >
                <TerminalSquare size={13} />
                {session.name}
                {session.command ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.16em]"
                    style={{ backgroundColor: `${accent.cyan}22`, color: accent.cyan }}
                  >
                    {t("terminal.commandTag")}
                  </span>
                ) : null}
                {session.closed ? <span className="text-white/30">×</span> : null}
              </button>
              <button
                type="button"
                onClick={() => void closeSession(session.sessionId)}
                aria-label={t("terminal.closeSession")}
                className="text-white/40 transition hover:text-rose-300"
              >
                <Square size={11} />
              </button>
            </div>
          ))}
        </div>

        {lastMessage ? (
          <p className="mt-4 text-xs text-white/52">{lastMessage}</p>
        ) : null}

        <div
          ref={hostRef}
          className="mt-4 min-h-[420px] overflow-hidden rounded-[24px] border border-white/10 bg-[#0f141b] p-3"
        />

        {openSessions.length === 0 ? (
          <div className="mt-4 rounded-[24px] border border-white/8 bg-black/16 p-6 text-center">
            <p className="text-sm font-semibold text-white/72">{t("terminal.noSessions")}</p>
            <p className="mt-2 text-xs text-white/42">{t("terminal.noSessionsDetail")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function RunInTerminalLauncher({
  process,
  accent,
  onLaunched,
}: {
  process: { id: string; name: string; startCommand?: string; cwd: string };
  accent: { cyan: string };
  onLaunched: (view: "terminal") => void;
}) {
  const { t } = useI18n();
  const bridge = getHostBridge();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!bridge?.createTerminalSession) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await bridge.createTerminalSession?.({
              cwd: process.cwd,
              command: process.startCommand || process.id,
              name: process.name,
            });
            onLaunched("terminal");
          } catch (reason) {
            const message = reason instanceof Error ? reason.message : String(reason);
            setError(
              message.includes("terminal-session-limit")
                ? t("terminal.limitReached")
                : message.includes("terminal-cwd-invalid")
                  ? t("terminal.cwdInvalid")
                  : t("terminal.createFailed"),
            );
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-white/60 transition hover:text-white"
        style={{ borderColor: `${accent.cyan}30` }}
      >
        {t("terminal.runInTerminal")}
      </button>
      {error ? <span className="text-[0.65rem] text-rose-300/80">{error}</span> : null}
    </>
  );
}
