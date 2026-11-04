// Builds public/app.js from the parts in src/app, in file-name order.
// The parts are pieces of one function (the app), cut by area, so read them in
// order: 00-start.js opens it, 18-swipe-update.js closes it.
//   node src/build.mjs          write public/app.js
//   node src/build.mjs --check  fail if public/app.js is not the parts joined, or
//                               public/sw.js's BUILD is not the files' fingerprint
// It also writes BUILD in public/sw.js: a fingerprint of every file the offline
// cache keeps (FILES). Phones open the app from that cache, and a new BUILD is how
// they learn a new version is out, so edit any of those files, then run this.
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "src/app");
const out = path.join(root, "public/app.js");
const parts = fs.readdirSync(dir).filter((f) => /^\d\d-.+\.js$/.test(f)).sort();
const app = parts.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");

// The fingerprint of the files public/sw.js keeps (with app.js as it is about to be).
const swPath = path.join(root, "public/sw.js");
function fingerprint(sw, appText) {
  const files = JSON.parse(sw.match(/const FILES = (\[[^\]]*\]);/)[1]);
  const h = crypto.createHash("sha256");
  for (const f of files) {
    // "/" is index.html; the manifest is one of these, chosen by the address (vercel.json).
    const real = f === "/" ? ["/index.html"] : f === "/manifest.webmanifest"
      ? fs.readdirSync(path.join(root, "public")).filter((x) => /^manifest-.+\.webmanifest$/.test(x)).sort().map((x) => "/" + x) : [f];
    for (const r of real) { h.update(r + "\0"); h.update(r === "/app.js" ? appText : fs.readFileSync(path.join(root, "public", r))); h.update("\0"); }
  }
  return h.digest("hex").slice(0, 10);
}
const swNow = fs.readFileSync(swPath, "utf8");
const build = fingerprint(swNow, app);
const swNew = swNow.replace(/const BUILD = "[0-9a-f]*";/, 'const BUILD = "' + build + '";');

if (process.argv.includes("--check")) {
  const now = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (now !== app) {
    console.error("public/app.js is out of date: edit the parts in src/app, then run node src/build.mjs");
    process.exit(1);
  }
  if (swNew !== swNow) {
    console.error("public/sw.js BUILD is out of date (a cached file changed): run node src/build.mjs");
    process.exit(1);
  }
  console.log("public/app.js matches src/app (" + parts.length + " parts), sw.js BUILD " + build);
} else {
  fs.writeFileSync(out, app);
  fs.writeFileSync(swPath, swNew);
  console.log("public/app.js built from " + parts.length + " parts, sw.js BUILD " + build);
}
