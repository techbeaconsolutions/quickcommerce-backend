const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const { ensureXvfb } = require("../utils/xvfb");
const { safeHeadless } = require("../utils/headless");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------
   DIRS
------------------------------------------------- */
const RESULTS_DIR = path.join(__dirname, "..", "results");

const outputPath = path.join(RESULTS_DIR, "zepto-result.json");

fs.mkdirSync(RESULTS_DIR, { recursive: true });

/* -------------------------------------------------
   XVFB
------------------------------------------------- */

/* -------------------------------------------------
   UTILS
------------------------------------------------- */
function makeSlug(str = "") {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function extractProductId(href = "") {
  const m = href.match(/pn\/([^/]+)/);
  return m ? m[1] : null;
}

function createZeptoUrl(href) {
  return href ? `https://www.zepto.com${href}` : "";
}

async function extractTextFallback(parent, selectors = []) {
  for (const sel of selectors) {
    try {
      const val = await parent.$eval(sel, (e) => e.innerText.trim());
      if (val) return val;
    } catch { }
  }
  return "";
}

/* -------------------------------------------------
   PROXY (WEBshare)
------------------------------------------------- */
function getProxy() {
  return {
    server: "http://p.webshare.io:80",
    username: "tqeehzfg-2",
    password: "rdedpatrpnhn",
  };
}

/* -------------------------------------------------
   MAIN SCRAPER
------------------------------------------------- */
async function scrapeZepto(
  pincode = "411048",
  query = "milk",
  headless = false,
  limit = 5
) {
  console.log(`🟣 Zepto → ${pincode} | ${query}`);
  await ensureXvfb();

  const browser = await chromium.launch({
    channel: "chrome",
    headless,
    proxy: getProxy(),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "Asia/Kolkata",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    /* ---------------- HOME ---------------- */
    await page.goto("https://www.zepto.com", { waitUntil: "domcontentloaded" });
    await sleep(2000);

    /* ---------------- LOCATION ---------------- */
    const locBtn = page.locator(
      "button:has-text('Select Location'), button:has-text('Deliver to')"
    );

    if (await locBtn.count()) {
      await locBtn.first().click();
      await page.waitForSelector("input[placeholder*='Search']", {
        timeout: 15000,
      });

      await page.fill("input[placeholder*='Search']", pincode);
      await sleep(2000);

      const suggestion = page
        .locator("[data-testid='address-search-item']")
        .first();

      if (await suggestion.count()) {
        await suggestion.click();
      } else {
        await page.keyboard.press("Enter");
      }

      await sleep(4000);
    }

    /* ---------------- SEARCH ---------------- */
    await page.goto(
      `https://www.zepto.com/search?query=${encodeURIComponent(query)}`,
      { waitUntil: "domcontentloaded" }
    );

    await sleep(3500);

    /* ---------------- HYDRATION RETRY ---------------- */
    for (let i = 1; i <= 3; i++) {
      try {
        await page.waitForFunction(
          () => document.querySelectorAll("a[href*='/pn/']").length > 5,
          { timeout: 15000 }
        );
        break;
      } catch {
        console.log(`⚠ Hydration retry ${i}`);
        await page.reload({ waitUntil: "domcontentloaded" });
        await sleep(3000);
      }
    }

    /* ---------------- SCROLL ---------------- */
    let lastHeight = 0;
    for (let i = 0; i < 10; i++) {
      const h = await page.evaluate(() => document.body.scrollHeight);
      if (h === lastHeight) break;
      lastHeight = h;
      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight)
      );
      await sleep(1200);
    }

    /* ---------------- SCRAPE ---------------- */
    const cards = await page.$$("a[href*='/pn/']");
    console.log(`🟢 Cards found: ${cards.length}`);

    if (!cards.length) {
      fs.writeFileSync(outputPath, "[]");
      await browser.close();
      return [];
    }

    const results = [];
    const seen = new Set();

    for (let i = 0; i < cards.length && results.length < limit; i++) {
      const card = cards[i];
      const href = (await card.getAttribute("href")) || "";
      const pid = extractProductId(href) || href;

      if (seen.has(pid)) continue;
      seen.add(pid);

      const name = await extractTextFallback(card, [
        "[data-slot-id='ProductName'] span",
        "h3",
        "p",
      ]);
      if (!name) continue;

      const price = await extractTextFallback(card, [
        "[data-slot-id='EdlpPrice'] span",
      ]);

      const qty = await extractTextFallback(card, [
        "[data-slot-id='PackSize'] span",
      ]);

      const img = await card.$eval("img", (e) => e.src).catch(() => "");

      results.push({
        platform: "Zepto",
        pincode,
        name,
        price,
        quantity: qty,
        image: img,
        slug: makeSlug(name),
        id: pid,
        url: createZeptoUrl(href),
        pos: results.length + 1,
      });

      console.log(`✔ ${results.length}. ${name}`);
    }

    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`💾 Saved ${results.length} items → ${outputPath}`);

    await browser.close();
    return results;
  } catch (err) {
    console.log("❌ Zepto error:", err.message);
    fs.writeFileSync(outputPath, "[]");
    await browser.close();
    return [];
  }
}

/* -------------------------------------------------
   CLI
------------------------------------------------- */
if (require.main === module) {
  (async () => {
    const [, , pincode, query, headlessArg, limitArg] = process.argv;

    await scrapeZepto(
      pincode || "411048",
      query || "milk",
      headlessArg === "true",
      Number(limitArg) || 5
    );

    console.log("✅ Zepto scrape completed");
    process.exit(0);
  })();
}

module.exports = scrapeZepto;