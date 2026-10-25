// Functional smoke test for the job persistence fixes. Runs under plain Node
// with an isolated XDG_CONFIG_HOME so the real ~/.config/mewl is never touched.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mewl-job-test-"));
process.env.XDG_CONFIG_HOME = configRoot;
const projectRoot = path.resolve(__dirname, "..");
const runtimePath = path.join(projectRoot, "electron", "runtime.cjs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const configPath = () => path.join(configRoot, "mewl", "mewl.services.json");

function freshRuntime() {
  delete require.cache[require.resolve(runtimePath)];
  delete require.cache[require.resolve(path.join(projectRoot, "electron", "settings.cjs"))];
  delete require.cache[require.resolve(path.join(projectRoot, "electron", "log-files.cjs"))];
  return require(runtimePath);
}

async function main() {
  let runtime = freshRuntime();

  // 1. Create a failing job and a succeeding job.
  const createJob = async (name, startCommand) => {
    const { snapshot } = await runtime.createManagedService({
      name,
      lifecycle: "job",
      startCommand,
      cwd: os.tmpdir(),
    });
    return snapshot.processes.find((p) => p.name === name);
  };
  const failed = await createJob("job-fail", "sh -c 'exit 3'");
  const ok = await createJob("job-ok", "sh -c 'echo done'");
  console.log("created jobs:", failed.id, ok.id);

  // 2. Run both to completion.
  await runtime.performProcessAction("start", failed.id);
  await runtime.performProcessAction("start", ok.id);
  await delay(1500);

  const onDisk = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  const failedSaved = onDisk.services.find((s) => s.id === failed.id);
  const okSaved = onDisk.services.find((s) => s.id === ok.id);
  console.log("persisted failed job:", {
    lastRunExit: failedSaved.lastRunExit,
    jobRunCount: failedSaved.jobRunCount,
  });
  console.log("persisted ok job:", {
    lastRunExit: okSaved.lastRunExit,
    jobRunCount: okSaved.jobRunCount,
  });
  if (failedSaved.lastRunExit !== 3 || failedSaved.jobRunCount !== 1) {
    throw new Error("FAIL: failing job terminal state not persisted as expected");
  }
  if (okSaved.lastRunExit !== 0 || okSaved.jobRunCount !== 1) {
    throw new Error("FAIL: succeeding job terminal state not persisted as expected");
  }

  // 3. Simulate an app restart: fresh module state, then hydrate should seed
  // job status from the config.
  runtime = freshRuntime();
  const snapshot = await runtime.hydrateRuntimeSnapshot({});
  const failedView = snapshot.processes.find((p) => p.id === failed.id);
  const okView = snapshot.processes.find((p) => p.id === ok.id);
  console.log("after restart, failed job status:", failedView.status, "runCount:", failedView.runCount, "lastRunExit:", failedView.lastRunExit);
  console.log("after restart, ok job status:", okView.status, "runCount:", okView.runCount, "lastRunExit:", okView.lastRunExit);
  if (failedView.status !== "failed" || failedView.runCount !== 1 || failedView.lastRunExit !== 3) {
    throw new Error("FAIL: failed job state not restored after restart");
  }
  if (okView.status !== "completed" || okView.runCount !== 1 || okView.lastRunExit !== 0) {
    throw new Error("FAIL: completed job state not restored after restart");
  }

  // 4. autoStart jobs must NOT run on the next boot sweep.
  const config = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  config.services = config.services.map((s) => ({ ...s, autoStart: true }));
  fs.writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
  runtime = freshRuntime();
  const bootSnapshot = await runtime.hydrateRuntimeSnapshot({});
  await delay(300);
  const recheck = await runtime.hydrateRuntimeSnapshot({});
  const anyRunning = recheck.processes.some(
    (p) => (p.id === failed.id || p.id === ok.id) && (p.status === "running" || p.status === "starting"),
  );
  const failedAfterBoot = recheck.processes.find((p) => p.id === failed.id);
  console.log("autoStart job booted again? running:", anyRunning, "| failed status still:", failedAfterBoot.status, "| runCount:", failedAfterBoot.runCount);
  if (anyRunning) {
    throw new Error("FAIL: autoStart job re-ran on boot");
  }
  if (failedAfterBoot.runCount !== 1) {
    throw new Error("FAIL: run count changed without a run");
  }

  // 5. Env snapshot round-trip: the renderer must see saved service env.
  const { snapshot: envCreateSnapshot } = await runtime.createManagedService({
    name: "env-service",
    lifecycle: "service",
    startCommand: "sleep 60",
    cwd: os.tmpdir(),
    env: { MEWL_TEST_VAR: "hello-env" },
  });
  const envService = envCreateSnapshot.processes.find((p) => p.name === "env-service");
  const envSnapshot = await runtime.hydrateRuntimeSnapshot({});
  const envView = envSnapshot.processes.find((p) => p.id === envService.id);
  console.log("env snapshot for service:", envView.env);
  if (envView.env?.MEWL_TEST_VAR !== "hello-env") {
    throw new Error("FAIL: service env missing from snapshot");
  }

  await runtime.shutdownManagedServices();
  console.log("ALL JOB SMOKE TESTS PASSED");
}

main()
  .then(() => {
    // Runtime modules leave timers/child processes on the event loop; the
    // assertions have all completed, so exit explicitly.
    // 运行时模块会留下定时器/子进程占用事件循环；断言均已完成后
    // 显式退出。
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
