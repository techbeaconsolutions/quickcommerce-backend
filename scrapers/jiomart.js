// scrapers/jiomart.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* =====================================================
   Utils
===================================================== */

// Normalize price like "₹45\n₹60" → "₹45"
function normalizePrice(price) {
  if (!price) return null;
  const match = price.match(/₹\s*(\d+)/);
  return match ? `₹${match[1]}` : null;
}

/* =====================================================
   Main Scraper
===================================================== */

async function scrapeJioMart(pincode, product) {
  console.log(`🟦 [JioMart] ${pincode} | ${product}`);

  const outputDir = path.join(__dirname, "..", "results");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, "jiomart-result.json");

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    locale: "en-IN",
    permissions: ["geolocation"],
    geolocation: { latitude: 18.5204, longitude: 73.8567 }, // Pune fallback
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    /* =====================================================
       1️⃣ Homepage
    ===================================================== */
    await page.goto("https://www.jiomart.com/", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    /* =====================================================
       2️⃣ Location popup (manual)
    ===================================================== */
    try {
      const manualBtn = page.locator("button", {
        hasText: "Select Location Manually",
      });
      if (await manualBtn.isVisible({ timeout: 3000 })) {
        console.log("📍 Clicking Select Location Manually");
        await manualBtn.click();
        await page.waitForTimeout(1500);
      }
    } catch { }

    /* =====================================================
       3️⃣ Guestmap
    ===================================================== */
    console.log("📍 Opening guestmap...");
    await page.goto("https://www.jiomart.com/customer/guestmap", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    /* =====================================================
       4️⃣ Enter PINCODE
    ===================================================== */
    console.log("⌨️ Typing pincode...");
    const searchInput = page.locator(
      "input[placeholder*='Search for area']"
    );

    await searchInput.waitFor({ timeout: 20000 });
    await searchInput.click();
    await searchInput.fill("");
    await searchInput.type(pincode, { delay: 120 });

    /* =====================================================
       5️⃣ Select first suggestion
    ===================================================== */
    await page.waitForTimeout(1500);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    /* =====================================================
       6️⃣ Confirm location
    ===================================================== */
    console.log("🗺 Waiting for confirm button...");
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll("button")).some((b) => {
        const t = (b.innerText || "").toLowerCase();
        return (
          t.includes("deliver") ||
          t.includes("confirm") ||
          t.includes("use this location")
        );
      });
    }, { timeout: 30000 });

    console.log("✅ Confirming location...");
    await page.evaluate(() => {
      for (const b of document.querySelectorAll("button")) {
        const t = (b.innerText || "").toLowerCase();
        if (
          t.includes("deliver") ||
          t.includes("confirm") ||
          t.includes("use this location")
        ) {
          b.click();
          return;
        }
      }
    });

    /* =====================================================
       7️⃣ Wait for redirect
    ===================================================== */
    await page.waitForURL(/jiomart\.com/i, { timeout: 30000 });
    console.log("🚀 Location locked successfully");
    await page.waitForTimeout(2000);

    /* =====================================================
       8️⃣ Search page
    ===================================================== */
    const searchUrl = `https://www.jiomart.com/search?q=${encodeURIComponent(
      product
    )}`;
    console.log(`🔎 Opening ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("li.ais-InfiniteHits-item", {
      timeout: 20000,
    });

    /* =====================================================
       9️⃣ Scroll
    ===================================================== */
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 1500);
      await sleep(1200);
    }

    /* =====================================================
       🔟 Scrape
    ===================================================== */
    console.log("🧮 Scraping products...");

    const rawProducts = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("li.ais-InfiniteHits-item")
      ).map((el) => {
        const name =
          el.querySelector(".plp-card-details-name")?.innerText?.trim() ||
          null;

        const price =
          el.querySelector(".jm-heading-xxs")?.innerText?.trim() ||
          null;

        const imageEl =
          el.querySelector("img[data-src]") || el.querySelector("img");

        const image =
          imageEl?.getAttribute("data-src") ||
          imageEl?.getAttribute("src") ||
          null;

        const url =
          el.querySelector("a.plp-card-wrapper")?.href || null;

        return { name, price, image, url };
      });
    });

    /* =====================================================
       1️⃣1️⃣ Normalize & Finalize
    ===================================================== */
    const finalData = rawProducts
      .map((p, index) => ({
        platform: "JioMart",
        pincode,
        name: p.name,
        price: normalizePrice(p.price),
        quantity: null,
        image: p.image,
        url: p.url,
        rank: index + 1,
      }))
      .filter((p) => p.name && p.price)
      .slice(0, 5);

    fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2));
    console.log(`✅ Saved ${finalData.length} products`);

    return finalData; // 🔥 REQUIRED FOR WORKER
  } catch (err) {
    console.error("❌ JioMart error:", err.message);
    return [];
  } finally {
    await browser.close();
  }
}

/* =====================================================
   CLI Support
===================================================== */

if (require.main === module) {
  const [pincode, product] = process.argv.slice(2);
  if (!pincode || !product) {
    console.log("Usage: node scrapers/jiomart.js <PINCODE> <PRODUCT>");
    process.exit(1);
  }
  scrapeJioMart(pincode, product);
}

module.exports = scrapeJioMart;
