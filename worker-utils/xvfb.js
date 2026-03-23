const cp = require("child_process");

function isXvfbRunning() {
  try {
    cp.execSync("pgrep Xvfb", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureXvfb() {
  // ✅ Xvfb is already alive
  if (process.env.DISPLAY && isXvfbRunning()) {
    console.log(`🖥️ Xvfb running on ${process.env.DISPLAY}`);
    return;
  }

  console.log("🖥️ Starting Xvfb on :99");

  try {
    // cleanup any stale Xvfb
    cp.execSync("pkill Xvfb || true", { stdio: "ignore" });

    const p = cp.spawn(
      "Xvfb",
      [":99", "-screen", "0", "1366x768x24", "-ac"],
      {
        detached: true,
        stdio: "ignore",
      }
    );

    p.unref();
    process.env.DISPLAY = ":99";

    // give X server time to boot
    await new Promise((r) => setTimeout(r, 1200));

    if (!isXvfbRunning()) {
      throw new Error("Xvfb failed to start");
    }

    console.log("✅ Xvfb started successfully");
  } catch (err) {
    console.error("❌ Xvfb startup failed:", err.message);
    delete process.env.DISPLAY;
  }
}

module.exports = { ensureXvfb };
