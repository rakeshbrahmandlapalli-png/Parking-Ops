// Builds public/app.js from the parts in src/app, in file-name order.
// The parts are pieces of one function (the app), cut by area, so read them in
// order: 00-start.js opens it, 18-swipe-update.js closes it.
//   node src/build.mjs          write public/app.js
//   node src/build.mjs --check  fail if public/app.js is not the parts joined
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "src/app");
const out = path.join(root, "public/app.js");
const parts = fs.readdirSync(dir).filter((f) => /^\d\d-.+\.js$/.test(f)).sort();
const app = parts.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");

if (process.argv.includes("--check")) {
  const now = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (now !== app) {
    console.error("public/app.js is out of date: edit the parts in src/app, then run node src/build.mjs");
    process.exit(1);
  }
  console.log("public/app.js matches src/app (" + parts.length + " parts)");
} else {
  fs.writeFileSync(out, app);
  console.log("public/app.js built from " + parts.length + " parts");
}
