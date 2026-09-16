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
    await page.goto(url || "http://localhost:3000", { waitUntil: "networkidle" });
    // wait-text (checking document.body.innerText) passes as soon as SSR'd
    // HTML lands, which can be before React finishes hydrating and
    // attaching click handlers - a click immediately after wait-text can
    // silently no-op. Give hydration a beat to finish.
    await page.waitForTimeout(500);
    console.log("launched, url:", page.url());
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

  // archsim-specific: ComponentCard is the only element with both
  // "rounded-lg" and "shadow-sm" classes (baseline summary and the
  // failure/fix panels use rounded-lg without shadow-sm) - find the card
  // whose text includes `cardText`, click the first button inside it.
  async "click-card-badge"(cardText) {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate((t) => {
      const cards = [...document.querySelectorAll(".rounded-lg.shadow-sm")];
      const card = cards.find((c) => c.textContent?.includes(t));
      if (!card) return "CARD_NOT_FOUND";
      const btn = card.querySelector("button");
      if (!btn) return "NO_BADGE_ON_CARD";
      btn.click();
      return "OK";
    }, cardText);
    console.log("click-card-badge", JSON.stringify(cardText), "->", r);
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

  // React controlled inputs track their value via a patched setter on the
  // element instance; setting el.value directly and dispatching "input"
  // (or Playwright's own .fill() on non-text input types) does not trigger
  // onChange. Calling the *prototype's* original value setter first, then
  // dispatching "input", is what actually fires React's handler - the
  // standard workaround. Needed for both the number inputs and the <input
  // type="range"> slider in ControlPanel, neither of which Playwright's
  // .fill() supports directly for range.
  async "set-input"(rest) {
    if (!page) return console.log("ERROR: launch first");
    const spaceIdx = rest.indexOf(" ");
    const sel = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
    const value = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1);
    const r = await page.evaluate(
      ({ sel, value }) => {
        const el = document.querySelector(sel);
        if (!el) return "NOT_FOUND";
        const proto = Object.getPrototypeOf(el);
        const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        descriptor.set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return "OK";
      },
      { sel, value },
    );
    console.log("set-input", sel, value, "->", r);
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
    try {
      await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout: 10000 });
      console.log("found text:", text);
    } catch {
      console.log("TIMEOUT waiting for text:", text);
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
