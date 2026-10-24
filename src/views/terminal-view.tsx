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
  const activeRef = useRef("");

  sessionsRef.current = sessions;
  activeRef.current = activeSessionId;

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const ensureTerminal = useCallback(() => {
    if (terminalRef.current || typeof window === "undefined") {
      return terminalRef.current;
    }

    void import("@xterm/xterm").then(({ Terminal: XTerm }) => {
      const term = new XTerm({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 13,
        theme: terminalTheme,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(hostRef.current!);
      fitAddon.fit();

      term.onData((data) => {
        if (activeRef.current) {
          bridge?.writeTerminal?.(activeRef.current, data);
        }
      });

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
    });

    return null;
  }, [bridge]);

  useEffect(() => {
    // The terminal host is a single persistent element reused across tab
    // switches; xterm sessions push bytes through the bridge by sessionId.
    // 终端宿主是跨标签切换复用的单一持久元素；xterm 会话按 sessionId
    // 经桥接推送字节。
    ensureTerminal();

    const unsubscribe = bridge?.subscribeToTerminal?.({
      onData: (payload) => {
        if (payload.type === "data" && payload.sessionId === activeRef.current) {
          terminalRef.current?.write(payload.data);
        }
      },
      onExit: (payload) => {
        if (payload.type !== "exit") {
          return;
        }

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

    return unsubscribe;
  }, [bridge, ensureTerminal, t]);

  useEffect(() => {
    const resizeObserver = new ResizeObserver(() => {
      const fitAddon = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fitAddon || !term || !activeSessionId) {
        return;
      }

      try {
        fitAddon.fit();
        bridge?.resizeTerminal?.(activeSessionId, term.cols, term.rows);
      } catch (_error) {
        // Transient zero-size layouts are skipped until the panel settles.
        // 面板尺寸未稳定时跳过偶发的零尺寸布局。
      }
    });

    if (hostRef.current) {
      resizeObserver.observe(hostRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [activeSessionId, bridge]);

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

      setSessions((current) => [...current, { ...created, closed: false }]);
      setActiveSessionId(created.sessionId);
      setComposerOpen(false);
      setLastMessage("");
      terminalRef.current?.reset();
      terminalRef.current?.focus();
    } catch (_error) {
      setLastMessage(t("terminal.createFailed"));
    }
  };

  const closeSession = async (sessionId: string) => {
    try {
      await bridge?.killTerminalSession?.(sessionId);
    } catch (_error) {
      setLastMessage(t("terminal.killFailed"));
      return;
    }

    setSessions((current) => {
      const next = current.filter((session) => session.sessionId !== sessionId);
      if (activeRef.current === sessionId) {
        setActiveSessionId(next[next.length - 1]?.sessionId ?? "");
        terminalRef.current?.reset();
      }

      return next;
    });
  };

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
                onClick={() => {
                  setActiveSessionId(session.sessionId);
                  terminalRef.current?.reset();
                  terminalRef.current?.focus();
                }}
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

        {sessions.length === 0 ? (
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

  if (!bridge?.createTerminalSession) {
    return null;
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await bridge.createTerminalSession?.({
            cwd: process.cwd,
            command: process.startCommand || process.id,
            name: process.name,
          });
          onLaunched("terminal");
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/18 px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-white/60 transition hover:text-white"
      style={{ borderColor: `${accent.cyan}30` }}
    >
      {t("terminal.runInTerminal")}
    </button>
  );
}
