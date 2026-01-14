// utils/playwright-env.js

// utils/playwright-env.js

module.exports = function configurePlaywrightEnv() {
    const isServer =
        process.env.CI ||
        process.env.RAILWAY_ENVIRONMENT ||
        process.env.HEROKU ||
        process.env.RENDER ||
        process.env.VERCEL ||
        process.env.DOCKER ||
        process.env.KUBERNETES_SERVICE_HOST ||
        process.env.CLOUD_ENV ||
        process.env.HETZNER ||            // cloud
        process.env.CONTABO ||            // 👈 NEW: Contabo detection
        process.env.USER === "root" ||    // 👈 VPS usually runs as root
        process.cwd().startsWith("/root"); // 👈 Contabo default directory

    if (isServer) {
        console.log("🌐 Running on SERVER → Using GLOBAL Playwright browsers");
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
        process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    } else {
        console.log("💻 Running on LOCAL MACHINE → Using LOCAL Playwright browsers");
    }
};

