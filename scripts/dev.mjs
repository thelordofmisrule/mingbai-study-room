import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const children = [
  spawn(npmCommand, ["run", "dev:server"], {
    stdio: "inherit",
    env: process.env,
  }),
  spawn(npmCommand, ["run", "dev:client"], {
    stdio: "inherit",
    env: process.env,
  }),
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(exitCode), 50);
}

for (const child of children) {
  child.on("exit", (code) => {
    shutdown(code ?? 0);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
