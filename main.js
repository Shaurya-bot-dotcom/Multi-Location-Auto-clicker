const { app, BrowserWindow, ipcMain, globalShortcut } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let win = null;
let running = false;
let targets = [];
let timers = [];

/* ------------------------------------------------------------------ */
/*  Mouse helper (PowerShell + user32.dll, no native npm modules)      */
/* ------------------------------------------------------------------ */

let helper = null;
let helperReady = null;
let pending = [];
let outBuf = "";

function resetHelper(reason) {
  const waiting = pending;
  pending = [];
  helper = null;
  helperReady = null;
  outBuf = "";
  for (const resolve of waiting) resolve("err " + reason);
}

function ensureHelper() {
  if (helperReady) return helperReady;

  helperReady = new Promise((resolve, reject) => {
    const script = path.join(__dirname, "mouse-helper.ps1");

    try {
      helper = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
        { windowsHide: true }
      );
    } catch (e) {
      helperReady = null;
      return reject(new Error("Could not start PowerShell: " + e.message));
    }

    const timeout = setTimeout(() => {
      reject(new Error("Mouse helper did not start (PowerShell blocked?)."));
    }, 15000);

    let gotReady = false;

    helper.stdout.on("data", (chunk) => {
      outBuf += chunk.toString();
      let i;
      while ((i = outBuf.indexOf("\n")) >= 0) {
        const line = outBuf.slice(0, i).trim();
        outBuf = outBuf.slice(i + 1);
        if (!line) continue;

        if (!gotReady) {
          if (line === "ready") {
            gotReady = true;
            clearTimeout(timeout);
            resolve();
          }
          continue;
        }
        const next = pending.shift();
        if (next) next(line);
      }
    });

    helper.stderr.on("data", (d) => console.error("helper:", d.toString()));

    helper.on("error", (e) => {
      clearTimeout(timeout);
      resetHelper(e.message);
      reject(new Error("PowerShell error: " + e.message));
    });

    helper.on("exit", () => {
      clearTimeout(timeout);
      resetHelper("helper-exited");
    });
  });

  helperReady.catch(() => { helperReady = null; });
  return helperReady;
}

function send(command) {
  return new Promise((resolve) => {
    if (!helper) return resolve("err no-helper");
    pending.push(resolve);
    helper.stdin.write(command + "\n");
  });
}

function stopHelper() {
  if (helper) {
    try { helper.stdin.write("quit\n"); } catch (_) {}
    try { helper.kill(); } catch (_) {}
  }
  resetHelper("stopped");
}

/* ------------------------------------------------------------------ */
/*  Window + messaging                                                 */
/* ------------------------------------------------------------------ */

function tell(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function message(text, isError = false) {
  tell("message", { text, isError });
}

function createWindow() {
  win = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 700,
    minHeight: 520,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("index.html");
}

/* ------------------------------------------------------------------ */
/*  Clicking                                                           */
/* ------------------------------------------------------------------ */

function stopAll() {
  running = false;
  for (const t of timers) clearInterval(t);
  timers = [];
  tell("state", false);
}

async function startAll() {
  if (running) return { ok: true };

  const active = targets
    .filter((t) => t && t.enabled !== false)
    .map((t) => ({
      x: Math.round(Number(t.x)),
      y: Math.round(Number(t.y)),
      interval: Math.max(50, Math.round(Number(t.interval)) || 1000),
      button: t.button === "right" ? "right" : "left",
      count: t.clicks === "double" ? 2 : 1,
      busy: false
    }))
    .filter((t) => Number.isFinite(t.x) && Number.isFinite(t.y));

  if (active.length === 0) {
    const err = "Add at least one enabled target first.";
    message(err, true);
    return { ok: false, error: err };
  }

  try {
    await ensureHelper();
  } catch (e) {
    message(e.message, true);
    return { ok: false, error: e.message };
  }

  running = true;
  tell("state", true);
  message("Running with " + active.length + " target(s). Use your Stop hotkey to stop.");

  const clickOnce = async (t) => {
    if (!running || t.busy) return;
    t.busy = true;
    const reply = await send(`click ${t.x} ${t.y} ${t.button} ${t.count}`);
    t.busy = false;
    if (reply.startsWith("err") && running) {
      stopAll();
      message("Click failed: " + reply, true);
    }
  };

  for (const t of active) {
    timers.push(setInterval(() => clickOnce(t), t.interval));
    clickOnce(t); // first click right away
  }

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  IPC                                                                */
/* ------------------------------------------------------------------ */

ipcMain.on("set-targets", (_e, incoming) => {
  targets = Array.isArray(incoming) ? incoming : [];
});

ipcMain.handle("start", () => startAll());

ipcMain.handle("stop", () => {
  stopAll();
  message("Stopped.");
  return { ok: true };
});

async function readPosition() {
  await ensureHelper();
  const reply = await send("pos");
  const m = /^pos (-?\d+) (-?\d+)$/.exec(reply);
  if (!m) throw new Error("Could not read mouse position: " + reply);
  return { x: Number(m[1]), y: Number(m[2]) };
}

ipcMain.handle("get-position", async () => {
  try {
    return { ok: true, ...(await readPosition()) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* ------------------------------------------------------------------ */
/*  App lifecycle + global hotkeys                                     */
/* ------------------------------------------------------------------ */

function registerHotkeys(h) {
  globalShortcut.unregisterAll();
  const failed = [];

  const reg = (name, key, fn) => {
    if (!key) return;
    let ok = false;
    try { ok = globalShortcut.register(key, fn); } catch (_) {}
    if (!ok) failed.push(`${name} (${key})`);
  };

  reg("Start/Stop", h.toggle, () => {
    if (running) { stopAll(); message("Stopped."); }
    else startAll();
  });

  reg("Stop", h.stop, () => { stopAll(); message("Stopped."); });

  reg("Add position", h.capture, async () => {
    try {
      tell("captured", await readPosition());
    } catch (e) {
      message(e.message, true);
    }
  });

  return failed;
}

ipcMain.handle("set-hotkeys", (_e, h) => {
  const failed = registerHotkeys(h || {});
  return { ok: failed.length === 0, failed };
});

app.whenReady().then(() => {
  createWindow();
});

app.on("window-all-closed", () => {
  stopAll();
  stopHelper();
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopHelper();
});
