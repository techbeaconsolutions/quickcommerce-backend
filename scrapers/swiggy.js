// scrapers/swiggy.js
// ✅ Production-safe Swiggy Instamart scraper (VPS / PM2 / xvfb ready)

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { safeHeadless } = require("../utils/headless");

// ------------------------------
// Humanization config
// ------------------------------
const HUMAN = {
  letterMin: 8,
  letterMax: 18,
  actionMin: 120,
  actionMax: 240,
  scrollMin: 200,
  scrollMax: 400,
  idleMin: 80,
  idleMax: 160,
  hydrationMin: 350,
  hydrationMax: 650,
};

const rand = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stepDelay(label = "", min = 120, max = 240) {
  const ms = rand(min, max);
  if (label) console.log(`⏸ ${label} — ${ms}ms`);
  await sleep(ms);
}

// ------------------------------
// Ensure output dir
// ------------------------------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(path.join(__dirname, "..", "results"));

// ------------------------------
// 🔐 Force headless on VPS
// ------------------------------
function resolveHeadless(cliHeadless) {
  if (!process.env.DISPLAY) return true;
  return cliHeadless !== false;
}

// ------------------------------
// Human typing
// ------------------------------
async function typeLikeHuman(page, selector, text) {
  await page.focus(selector);
  await stepDelay("focus input", HUMAN.idleMin, HUMAN.idleMax);

  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(rand(HUMAN.letterMin, HUMAN.letterMax));
  }
}

/* -------------------------------------------------
   PROXY (Webshare)
------------------------------------------------- */
function getProxy() {
  return {
    server: "http://p.webshare.io:80",
    username: "tqeehzfg-2",
    password: "rdedpatrpnhn",
  };
}

// ------------------------------
// 🚫 Close blocking overlays (FIX)
// ------------------------------
async function closeBlockingOverlays(page) {
  try {
    const overlay = page.locator('div[data-testid="modal-overlay"]');
    if (await overlay.count()) {
      console.log("⚠ Closing modal overlay");
      await overlay.first().click({ timeout: 3000 }).catch(() => { });
      await page.waitForTimeout(400);
    }

    await page.evaluate(() => {
      document
        .querySelectorAll(
          'div[data-testid="modal-overlay"], div[role="dialog"], div[class*="Overlay"]'
        )
        .forEach((el) => el.remove());
    });
  } catch { }
}

// ------------------------------
// Scroll loader
// ------------------------------
async function scrollToLoad(page, selector, minItems = 5, maxScroll = 12) {
  let last = 0;

  for (let i = 0; i < maxScroll; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
    await stepDelay("scroll", HUMAN.scrollMin, HUMAN.scrollMax);

    const count = await page
      .$eval(selector, (els) => els.length)
      .catch(() => 0);

    if (count > last) last = count;
    if (count >= minItems) break;
  }
  return last;
}

// ------------------------------
// PDP scraper
// ------------------------------
async function scrapePDP(page) {
  await page.waitForSelector('[data-testid="itemName"]', { timeout: 15000 });

  return {
    name: await page
      .$eval('[data-testid="itemName"]', (e) => e.innerText.trim())
      .catch(() => ""),
    price: await page
      .$eval('[data-testid="item-offer-price"]', (e) => e.innerText.trim())
      .catch(() => ""),
    quantity: await page
      .$eval('div[class*="_11EdJ"]', (e) => e.innerText.trim())
      .catch(() => ""),
    image: await page
      .$eval('img[src*="instamart"]', (e) => e.src)
      .catch(() => ""),
    url: page.url(),
    scrapedAt: new Date().toISOString(),
  };
}

// ------------------------------
// MAIN SCRAPER
// ------------------------------
async function scrapeSwiggyDOM(pincode, query, cliHeadless = false, limit = 5) {
  console.log(
    `🟠 Swiggy | pincode=${pincode} | query="${query}" | limit=${limit}`
  );

  const headless = resolveHeadless(cliHeadless);

  const browser = await chromium.launch({
    channel: "chrome",
    headless,
    proxy: getProxy(), // ✅ PROXY ADDED
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,900",
    ],
  });


  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124",
  });


  const page = await context.newPage();

  // ---------------- HOME ----------------
  await page.goto("https://www.swiggy.com/instamart", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await closeBlockingOverlays(page);

  // ---------------- SEARCH ----------------
  await page.waitForSelector('button[data-testid="search-container"]', {
    timeout: 20000,
  });

  await closeBlockingOverlays(page);

  await page.click('button[data-testid="search-container"]', {
    force: true,
  });

  const inputSel =
    'input[data-testid="search-page-header-search-bar-input"]';

  await page.waitForSelector(inputSel, { timeout: 20000 });

  await typeLikeHuman(page, inputSel, query);
  await page.keyboard.press("Enter");

  await stepDelay("post search", 800, 1400);

  // ---------------- RESULTS ----------------
  const cardSel =
    'div[data-testid="item-collection-card-full"], div[class*="ItemCollectionCard"]';

  await page.waitForSelector(cardSel, { timeout: 20000 });
  await stepDelay("results hydration", HUMAN.hydrationMin, HUMAN.hydrationMax);

  const total = await scrollToLoad(page, cardSel, limit);
  console.log(`🧾 Cards loaded: ${total}`);

  const results = [];

  for (let i = 0; i < Math.min(limit, total); i++) {
    const cards = await page.$$(cardSel);
    const card = cards[i];
    if (!card) continue;

    await card.click({ force: true });
    await stepDelay("open PDP", 500, 900);

    const pdp = await scrapePDP(page);
    pdp.platform = "Swiggy";
    pdp.pincode = pincode;

    results.push(pdp);
    console.log(`✔ ${i + 1}. ${pdp.name}`);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await closeBlockingOverlays(page);
    await stepDelay("return to list", 400, 800);
  }

  await browser.close();

  const outPath = path.join(
    __dirname,
    "..",
    "results",
    "swiggy-result.json"
  );

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  return results;
}

// ------------------------------
// CLI SUPPORT
// ------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);

  const pincode = args.shift() || "411048";

  let query = "milk";
  let limit = 5;
  let headless = false;

  for (const arg of args) {
    if (arg === "true" || arg === "false") headless = arg === "true";
    else if (/^\d+$/.test(arg)) limit = Number(arg);
    else query = arg;
  }

  console.log("📌 Parsed CLI:");
  console.log("  Pincode :", pincode);
  console.log("  Query   :", query);
  console.log("  Headless:", headless);
  console.log("  Limit   :", limit);

  scrapeSwiggyDOM(pincode, query, headless, limit)
    .then(() => console.log("✅ Swiggy scrape done"))
    .catch((err) => {
      console.error("❌ Swiggy scrape failed:", err.message);
      process.exit(1);
    });
}

module.exports = scrapeSwiggyDOM;
