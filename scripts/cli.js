import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...inputArgs] = process.argv.slice(2);
const args = [...inputArgs];
let portal = "naukri";

for (let index = 0; index < args.length; index++) {
  if (args[index] === "--portal") {
    portal = args[index + 1] ?? "";
    args.splice(index, 2);
    index--;
  } else if (args[index].startsWith("--portal=")) {
    portal = args[index].slice("--portal=".length);
    args.splice(index, 1);
    index--;
  }
}

if (!["naukri", "linkedin"].includes(portal)) {
  console.error(`Unknown portal "${portal}". Choose "naukri" or "linkedin".`);
  process.exit(2);
}

const scripts = {
  scan: {
    naukri: ["src/index.js", "scan"],
    linkedin: ["scripts/linkedin.js", "scan"],
  },
  list: {
    naukri: ["src/index.js", "list"],
    linkedin: ["scripts/linkedin.js", "list"],
  },
  apply: {
    naukri: ["src/apply.js"],
    linkedin: ["scripts/linkedin-apply.js"],
  },
  external: {
    naukri: ["scripts/list-external-jobs.js", "--portal", "naukri"],
    linkedin: ["scripts/list-external-jobs.js", "--portal", "linkedin"],
  },
};

const target = scripts[command]?.[portal];
if (!target) {
  console.error(`Unknown command "${command}". Use scan, list, apply, or external.`);
  process.exit(2);
}

const [script, ...targetArgs] = target;
const result = spawnSync(process.execPath, [path.join(ROOT, script), ...targetArgs, ...args], {
  cwd: ROOT,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
