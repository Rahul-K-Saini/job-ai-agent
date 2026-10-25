import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export function load(file = config.dataFile) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function save(db, file = config.dataFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
}
