import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const localTarball = path.join(root, ".artifacts", "local", "crewbee-project-context-local.tgz");

runNpm(["run", "pack:local"]);
runNode([path.join(root, "bin", "crewbee-project-context.js"), "install", "--source", "local", "--local-tarball", localTarball]);

console.log("Local crewbee-project-context install completed.");

function runNpm(args) {
  const npm = resolveNpmCommand();
  run(npm.command, [...npm.argsPrefix, ...args]);
}

function runNode(args) {
  run(process.execPath, args);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolveNpmCommand() {
  if (process.platform !== "win32") return { command: "npm", argsPrefix: [] };
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const cli = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(cli)) return { command: process.execPath, argsPrefix: [cli] };
    for (const name of ["npm", "npm.cmd", "npm.exe"]) {
      const executable = path.join(dir, name);
      const adjacentCli = path.join(path.dirname(executable), "node_modules", "npm", "bin", "npm-cli.js");
      if (existsSync(adjacentCli)) return { command: process.execPath, argsPrefix: [adjacentCli] };
    }
  }
  return { command: "npm", argsPrefix: [] };
}
