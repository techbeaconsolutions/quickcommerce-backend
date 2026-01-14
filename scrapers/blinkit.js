const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { safeHeadless } = require("../utils/headless");

const DEFAULT_LIMIT = 5;
const DEFAULT_TIMEOUT = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...args) {
  console.log(...args);
}

function makeSlug(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createBlinkitUrl(id, title) {
  return id ? `https://blinkit.com/prn/${makeSlug(title)}/prid/${id}` : "";
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}


/* ---------- BROWSER ---------- */
async function launchBrowser({ headless = false } = {}) {
  const browser = await chromium.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return { browser, context };
}

/* ---------- PINCODE ---------- */
async function ensurePincodeSet(page, pincode) {
  try {
    log("📌 Setting pincode:", pincode);
    await sleep(1200);

    let input = await page.$(
      'input[name="select-locality"], input[placeholder*="pincode"], input[type="search"]'
    );

    if (!input) {
      await page.click("text=Deliver to");
      await sleep(500);
      input = await page.waitForSelector('input[type="search"]', {
        timeout: 5000,
      });
    }

    await input.click();
    await input.fill(pincode);
    await sleep(1000);

    const firstLocation = await page.waitForSelector(
      "div[class*='LocationSearch'] div[class*='Location']",
      { timeout: 6000 }
    );

    await firstLocation.click();
    await sleep(1500);

    log("✅ Pincode applied");
    return true;
  } catch (err) {
    log("⚠️ Pincode failed:", err.message);
    return false;
  }
}

/* ---------- CARD PARSER ---------- */

async function extractFromCard(card) {
  try {
    const id = await card.getAttribute("id");

    const title = await card.evaluate((root) => {
      const el = root.querySelector("div.tw-font-semibold");
      return el ? el.innerText.trim() : "";
    });


    if (!title) return null;

    const qty = await card
      .$eval("div.tw-text-200.tw-font-medium", el => el.innerText.trim())
      .catch(() => "");

    // ✅ CORRECT Blinkit price extraction
    const priceText = await card.evaluate((root) => {
      // find the price block (container that also contains ADD)
      const priceBlock = Array.from(
        root.querySelectorAll("div.tw-flex.tw-items-center.tw-justify-between")
      ).find(div => div.innerText.includes("ADD"));

      if (!priceBlock) return "";

      // inside price block, find selling price (not line-through)
      const priceEl = priceBlock.querySelector(
        ".tw-text-200.tw-font-semibold:not(.tw-line-through)"
      );

      if (!priceEl) return "";

      const txt = priceEl.innerText.trim();
      return txt.replace(/[^\d]/g, "");
    });


    const image = await card.$eval("img", el => el.src).catch(() => "");

    return {
      id,
      title,
      qty,
      price: priceText ? `₹${priceText}` : "",
      image,              // ✅ FIXED
      slug: makeSlug(title),
      url: createBlinkitUrl(id, title),
      platform: "Blinkit",
    };
  } catch {
    return null;
  }
}

/* ---------- MAIN SCRAPER ---------- */
async function scrapeBlinkit(pincode, searchTerm, options = {}) {
  const { headless = false, limit = DEFAULT_LIMIT } = options;

  log(`🟩 Blinkit → ${pincode} | ${searchTerm}`);

  const outDir = path.join(__dirname, "..", "results");
  ensureDir(outDir);
  const outputPath = path.join(outDir, "blinkit-result.json");

  const { browser, context } = await launchBrowser({ headless });
  const page = await context.newPage();

  try {
    /* HOME */
    await page.goto("https://www.blinkit.com/", {
      timeout: DEFAULT_TIMEOUT,
      waitUntil: "domcontentloaded",
    });

    await sleep(1500);

    if (!(await ensurePincodeSet(page, pincode))) {
      await sleep(2000);
      await ensurePincodeSet(page, pincode);
    }

    /* SEARCH */
    const searchUrl = `https://blinkit.com/s/?q=${encodeURIComponent(
      searchTerm
    )}&pincode=${pincode}`;

    log("🔍", searchUrl);

    await page.goto(searchUrl, {
      timeout: DEFAULT_TIMEOUT,
      waitUntil: "domcontentloaded",
    });

    await sleep(1500);

    /* SCROLL */
    let prevCount = 0;
    const cardSelector = 'div[id][class*="tw-flex-col"]';

    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 1200);
      await sleep(800);

      const count = await page.$$eval(cardSelector, (els) => els.length);
      if (count === prevCount) break;
      prevCount = count;
    }

    const cards = await page.$$(cardSelector);
    log(`📦 Cards found: ${cards.length}`);

    const results = [];
    const take = Math.min(limit, cards.length);

    for (let i = 0; i < take; i++) {
      const item = await extractFromCard(cards[i]);
      if (!item) continue;

      item.pincode = pincode;
      item.pos = i + 1;
      results.push(item);

      log(`✔ ${i + 1}. ${item.title}`);
    }

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    log(`💾 Saved ${results.length} items`);

    await browser.close();
    return results;
  } catch (err) {
    log("❌ Blinkit error:", err.message);
    await browser.close();
    fs.writeFileSync(outputPath, "[]");
    return [];
  }
}

/* ---------- CLI ---------- */
if (require.main === module) {
  const [, , pincode, product, headlessArg, limitArg] = process.argv;

  scrapeBlinkit(pincode, product, {
    headless: headlessArg === "false" ? false : true,
    limit: limitArg ? Number(limitArg) : DEFAULT_LIMIT,
  });
}

module.exports = scrapeBlinkit;
