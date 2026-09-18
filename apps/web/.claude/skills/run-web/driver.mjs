// Minimal REPL driver for driving a browser-based dev server headlessly.
// Adapted from the run skill's electron.md skeleton, simplified: no
// window-finding needed for a plain web page.
import { chromium } from "playwright";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

const SHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });

let browser = null;
let page = null;

const COMMANDS = {
  async launch(url) {
    if (browser) return console.log("already launched");
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    page = await (await browser.newContext()).newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[console error]", msg.text());
    });
    page.on("pageerror", (err) => console.log("[page error]", err.message));
    // Playwright auto-dismisses window.confirm/alert by default (returns
    // false) unless a page has its own handler - archsim's "New Project"
    // button gates a real reset behind window.confirm, so leaving this
    // unhandled would make every click silently no-op instead of clicking
    // through, same as a real user hitting OK.
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto(url || "http://localhost:3000", { waitUntil: "networkidle" });
    // wait-text (checking document.body.innerText) passes as soon as SSR'd
    // HTML lands, which can be before React finishes hydrating and
    // attaching click handlers - a click immediately after wait-text can
    // silently no-op. Give hydration a beat to finish.
    await page.waitForTimeout(500);
    console.log("launched, url:", page.url());
  },

  // Reloads the current page in the SAME browser context - unlike calling
  // `launch` again (a no-op once a browser exists), this is how to verify
  // anything backed by localStorage (e.g. archsim's saved-session restore),
  // since localStorage is scoped to the context/origin, not a single page.
  async reload() {
    if (!page) return console.log("ERROR: launch first");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    console.log("reloaded, url:", page.url());
  },

  async ss(name) {
    if (!page) return console.log("ERROR: launch first");
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + ".png");
    await page.screenshot({ path: f, fullPage: true });
    console.log("screenshot:", f);
  },

  async click(sel) {
    if (!page) return console.log("ERROR: launch first");
    try {
      await page.click(sel, { timeout: 5000 });
      console.log("click", sel, "-> OK");
    } catch (e) {
      console.log("click", sel, "-> ERROR:", e.message.split("\n")[0]);
    }
  },

  // archsim-specific: the flow diagram (React Flow) wraps every custom node
  // in a ".react-flow__node" element; find the one whose text includes
  // `nodeText` (component label or id), then click its amber failure-count
  // badge (the only button inside a node, titled "N possible failure(s)"
  // by FailureIndicator.tsx). Replaces the old card-grid-era
  // "click-card-badge", dead since ComponentCard was removed in favor of
  // the flow diagram.
  async "click-node-badge"(nodeText) {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate((t) => {
      const nodes = [...document.querySelectorAll(".react-flow__node")];
      const node = nodes.find((n) => n.textContent?.includes(t));
      if (!node) return "NODE_NOT_FOUND";
      const btn = node.querySelector("button[title*='possible failure']");
      if (!btn) return "NO_BADGE_ON_NODE";
      btn.click();
      return "OK";
    }, nodeText);
    console.log("click-node-badge", JSON.stringify(nodeText), "->", r);
  },

  // `<sel> <text...>` - Playwright's real `fill()`, not a raw eval value
  // assignment: React tracks a controlled input's last value internally and
  // ignores a plain `el.value = x` + dispatched "input" event, so ProseInput's
  // textarea silently never updates state that way. `fill()` goes through
  // Playwright's actual input pipeline, which React does pick up.
  async type(rest) {
    if (!page) return console.log("ERROR: launch first");
    const idx = rest.indexOf(" ");
    const sel = idx === -1 ? rest : rest.slice(0, idx);
    const text = idx === -1 ? "" : rest.slice(idx + 1);
    try {
      await page.fill(sel, text, { timeout: 5000 });
      console.log("type", sel, "-> OK");
    } catch (e) {
      console.log("type", sel, "-> ERROR:", e.message.split("\n")[0]);
    }
  },

  async "click-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll("button, a, [role='button']")];
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return "NOT_FOUND";
      el.click();
      return "OK: " + el.tagName;
    }, text);
    console.log("click-text", JSON.stringify(text), "->", r);
  },

  async wait(sel) {
    if (!page) return console.log("ERROR: launch first");
    try {
      await page.waitForSelector(sel, { timeout: 10000 });
      console.log("found:", sel);
    } catch {
      console.log("TIMEOUT:", sel);
    }
  },

  async "wait-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    // 45s, not 10s: this app's own actions (Build model, Re-simulate, Apply
    // this fix) are live LLM calls, several of them chained per action
    // (e.g. fromProse's topology + workload calls, then a follow-up
    // identify-failures call) - routinely slower than a typical UI wait.
    try {
      await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 45000 });
      console.log("found text:", text);
    } catch {
      console.log("TIMEOUT waiting for text:", text);
    }
  },

  // Waits for text to DISAPPEAR - the counterpart wait-text lacks. Needed
  // for archsim specifically: the header's static copy ("...a possible
  // failure carries an indicator...") permanently contains words like
  // "possible failure", so wait-text for that phrase resolves instantly
  // regardless of whether identifyFailures has actually finished - only
  // waiting for the transient "Reviewing..."/"Reviewing this architecture"
  // status text to go away reliably signals findings have loaded.
  async "wait-gone"(text) {
    if (!page) return console.log("ERROR: launch first");
    try {
      await page.waitForFunction((t) => !document.body.innerText.includes(t), text, { timeout: 45000 });
      console.log("gone:", text);
    } catch {
      console.log("TIMEOUT waiting for text to disappear:", text);
    }
  },

  async text(sel) {
    if (!page) return console.log("ERROR: launch first");
    console.log(await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? "(null)", sel || null));
  },

  async eval(expr) {
    if (!page) return console.log("ERROR: launch first");
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  },

  async quit() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    page = null;
  },
  help() {
    console.log("commands:", Object.keys(COMMANDS).join(", "));
  },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync("/dev/stdin", "r") });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: "driver> " });

// readline's 'line' event fires for every buffered line as soon as it's
// read, WITHOUT waiting for an async handler's promise to resolve - piping
// a whole script at once (not typed interactively) meant every command ran
// concurrently against a browser that hadn't launched yet. Chain each
// line's processing onto a single promise so commands run strictly in order.
let queue = Promise.resolve();

rl.on("line", (line) => {
  queue = queue.then(() => processLine(line)).catch((e) => console.log("ERROR:", e.message));
});

async function processLine(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return maybePrompt();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log("unknown:", cmd, "- try: help");
    return maybePrompt();
  }
  try {
    await fn(rest.join(" "));
  } catch (e) {
    console.log("ERROR:", e.message);
  }
  if (cmd === "quit") {
    rl.close();
    process.exit(0);
  }
  maybePrompt();
}

// Piped (non-TTY) input closes the readline interface internally as soon as
// stdin ends - which happens almost immediately for a heredoc, well before
// the queued async commands finish. rl.prompt() on an already-closed
// interface logs a spurious "readline was closed" after every command.
function maybePrompt() {
  if (!rl.closed) rl.prompt();
}
rl.on("close", async () => {
  // Piped input (heredoc) closes stdin as soon as it's all been read into
  // the "line" event queue - that can happen before the chained async
  // commands have actually run. Wait for the queue to drain first, or a
  // piped script's tail commands silently never execute.
  await queue.catch(() => {});
  await COMMANDS.quit();
  process.exit(0);
});

console.log("driver ready - \"help\" for commands, \"launch\" to start");
rl.prompt();
