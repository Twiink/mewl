const os = require("node:os");
const path = require("node:path");
const pty = require("node-pty");

// Interactive PTY sessions for the Terminal workspace. Sessions are detached
// from managed-service lifecycle tracking: running a service's command here is
// a debugging convenience, so the runtime never counts these processes as
// managed children.
// Terminal 工作区的交互式 PTY 会话。会话与托管服务生命周期解耦：
// 在这里运行服务命令只是调试便利，运行时不会把这些进程计为托管子进程。
const sessions = new Map();

let streamListener = null;

function setTerminalListener(listener) {
  streamListener = typeof listener === "function" ? listener : null;
}

function emitStream(payload) {
  if (streamListener) {
    try {
      streamListener(payload);
    } catch (_error) {
      // Renderer-side listener failures must not break the PTY data flow.
      // 渲染层监听器异常不能中断 PTY 数据流。
    }
  }
}

function createSessionId() {
  return `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveCwd(cwd) {
  const requested = String(cwd || "").trim();
  if (!requested) {
    return os.homedir();
  }

  return path.isAbsolute(requested) ? requested : path.resolve(os.homedir(), requested);
}

function createTerminalSession({ cwd, cols, rows, command, name } = {}) {
  const sessionId = createSessionId();
  const sessionCwd = resolveCwd(cwd);
  const sessionCols = Math.min(500, Math.max(20, Math.round(Number(cols) || 80)));
  const sessionRows = Math.min(300, Math.max(6, Math.round(Number(rows) || 24)));
  const commandLine = String(command || "").trim();
  const shellPath = process.env.SHELL || "/bin/bash";

  // A supplied command runs through a login shell so PATH and profile setup
  // match what the managed runner would see; without one the session is a
  // plain interactive shell in the requested working directory.
  // 提供命令时通过登录 shell 执行，使 PATH 与 profile 环境与托管运行器
  // 一致；未提供命令时就是请求工作目录内的普通交互 shell。
  const term = commandLine
    ? pty.spawn(shellPath, ["-l", "-c", commandLine], {
        name: "xterm-256color",
        cols: sessionCols,
        rows: sessionRows,
        cwd: sessionCwd,
        env: { ...process.env, TERM: "xterm-256color" },
      })
    : pty.spawn(shellPath, [], {
        name: "xterm-256color",
        cols: sessionCols,
        rows: sessionRows,
        cwd: sessionCwd,
        env: { ...process.env, TERM: "xterm-256color" },
      });

  sessions.set(sessionId, {
    id: sessionId,
    term,
    name: String(name || commandLine || path.basename(shellPath)).slice(0, 48),
    createdAt: Date.now(),
  });

  term.onData((data) => {
    emitStream({ type: "data", sessionId, data });
  });

  term.onExit(({ exitCode }) => {
    sessions.delete(sessionId);
    emitStream({ type: "exit", sessionId, exitCode });
  });

  return {
    sessionId,
    pid: term.pid,
    name: sessions.get(sessionId).name,
    cwd: sessionCwd,
    command: commandLine || null,
  };
}

function writeTerminalInput(sessionId, data) {
  const session = sessions.get(sessionId);
  if (!session || typeof data !== "string") {
    return false;
  }

  session.term.write(data);
  return true;
}

function resizeTerminalSession(sessionId, cols, rows) {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.term.resize(
    Math.min(500, Math.max(20, Math.round(Number(cols) || 80))),
    Math.min(300, Math.max(6, Math.round(Number(rows) || 24))),
  );
  return true;
}

function killTerminalSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  sessions.delete(sessionId);
  try {
    session.term.kill();
  } catch (_error) {
    // The PTY may have exited between the map lookup and the kill call.
    // PTY 可能在查表与 kill 之间已经退出。
  }

  emitStream({ type: "exit", sessionId, exitCode: null, killed: true });
  return true;
}

function killAllTerminalSessions() {
  for (const sessionId of [...sessions.keys()]) {
    killTerminalSession(sessionId);
  }
}

function listTerminalSessions() {
  return [...sessions.values()].map((session) => ({
    sessionId: session.id,
    pid: session.term.pid,
    name: session.name,
    createdAt: session.createdAt,
  }));
}

module.exports = {
  createTerminalSession,
  writeTerminalInput,
  resizeTerminalSession,
  killTerminalSession,
  killAllTerminalSessions,
  listTerminalSessions,
  setTerminalListener,
};
