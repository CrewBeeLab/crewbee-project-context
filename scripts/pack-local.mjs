import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const packageRoot = process.cwd();
const outputDir = path.join(packageRoot, ".artifacts", "local");
const stableTarballPath = path.join(outputDir, "crewbee-project-context-local.tgz");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const npmCommand = resolveNpmCommand();
const result = spawnSync(npmCommand.command, [...npmCommand.argsPrefix, "pack", "--pack-destination", outputDir], {
  cwd: packageRoot,
  stdio: "inherit"
});

if (result.error) throw result.error;

if (result.status !== 0) process.exit(result.status ?? 1);

const generatedTarballName = readdirSync(outputDir).find((entry) => /^crewbee-project-context-.*\.tgz$/i.test(entry));
if (!generatedTarballName) {
  console.error(`No crewbee-project-context tarball was generated in ${outputDir}`);
  process.exit(1);
}

const generatedTarballPath = path.join(outputDir, generatedTarballName);
if (generatedTarballPath !== stableTarballPath) renameSync(generatedTarballPath, stableTarballPath);
console.log(`Local crewbee-project-context package written to ${stableTarballPath}`);

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
