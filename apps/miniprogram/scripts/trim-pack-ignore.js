const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const cfgPath = path.join(root, "project.config.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

const needed = new Set([
  "behaviors",
  "button",
  "common",
  "date-time-picker",
  "helpers",
  "icon",
  "input",
  "loading",
  "locale",
  "mixins",
  "navbar",
  "overlay",
  "picker",
  "picker-item",
  "popup",
  "switch",
]);

function collectDeps(name, depth = 0) {
  if (depth > 5) return;
  const dir = path.join(root, "miniprogram_npm/tdesign-miniprogram", name);
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const comps = json.usingComponents || {};
      Object.values(comps).forEach((value) => {
        const text = String(value);
        let match = text.match(/tdesign-miniprogram\/([^/]+)\//);
        if (!match) match = text.match(/\.\.\/([^/]+)\//);
        if (match && !needed.has(match[1])) {
          needed.add(match[1]);
          collectDeps(match[1], depth + 1);
        }
      });
    } catch (error) {
      // ignore invalid json
    }
  }
}

[...needed].forEach((name) => collectDeps(name));

const allDirs = fs
  .readdirSync(path.join(root, "miniprogram_npm/tdesign-miniprogram"), { withFileTypes: true })
  .filter((item) => item.isDirectory())
  .map((item) => item.name);

const unused = allDirs.filter((name) => !needed.has(name) && name !== "miniprogram_npm");

const ignore = [
  { type: "folder", value: "pages/example" },
  { type: "folder", value: "components/cloudTipModal" },
  { type: "folder", value: "cloudfunctions" },
  { type: "folder", value: "node_modules" },
  { type: "folder", value: ".agents" },
  { type: "folder", value: ".cloudbase" },
  { type: "file", value: "package-lock.json" },
  { type: "file", value: "package.json" },
  { type: "file", value: "images/ai_example2.png" },
  { type: "file", value: "images/create_cbr.png" },
  { type: "file", value: "images/database.png" },
  { type: "file", value: "images/arrow.svg" },
  { type: "file", value: "images/copy.svg" },
  ...unused.map((name) => ({
    type: "folder",
    value: `miniprogram_npm/tdesign-miniprogram/${name}`,
  })),
];

cfg.packOptions = cfg.packOptions || {};
cfg.packOptions.ignore = ignore;
cfg.srcMiniprogramRoot = "/";
cfg.setting = cfg.setting || {};
cfg.setting.uploadWithSourceMap = false;
cfg.setting.minified = true;
cfg.setting.minifyWXSS = true;
cfg.setting.minifyWXML = true;

fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
console.log("needed:", [...needed].sort().join(", "));
console.log("ignored tdesign components:", unused.length);
console.log("total ignore rules:", ignore.length);
