// scrapers/jiomart.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

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
       2️⃣ Click "Select Location Manually" if popup appears
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
       3️⃣ Open guestmap
    ===================================================== */
    console.log("📍 Opening guestmap...");
    await page.goto("https://www.jiomart.com/customer/guestmap", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2000);

    /* =====================================================
       4️⃣ Type PINCODE in search input
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
       5️⃣ Wait for suggestions & click first
    ===================================================== */
    console.log("📍 Selecting first location suggestion...");
    console.log("📍 Selecting first suggestion using keyboard...");

    // wait a bit for Google suggestions to appear
    await page.waitForTimeout(1500);

    // ArrowDown selects first suggestion
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);

    // Enter confirms it
    await page.keyboard.press("Enter");

    // wait for map + address resolution
    await page.waitForTimeout(3000);

    await page.waitForTimeout(3000);

    /* =====================================================
       6️⃣ Wait for confirm / deliver button
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

    /* =====================================================
       7️⃣ Click confirm
    ===================================================== */
    console.log("✅ Confirming location...");
    const confirmed = await page.evaluate(() => {
      for (const b of document.querySelectorAll("button")) {
        const t = (b.innerText || "").toLowerCase();
        if (
          t.includes("deliver") ||
          t.includes("confirm") ||
          t.includes("use this location")
        ) {
          b.click();
          return true;
        }
      }
      return false;
    });

    if (!confirmed) {
      throw new Error("Confirm location button not found");
    }

    /* =====================================================
       8️⃣ Wait for redirect to Quick page
    ===================================================== */
    await page.waitForURL(/jiomart\.com\/\?tab=groceries|jiomart\.com\/\?/i, {
      timeout: 30000,
    });

    console.log("🚀 Location locked successfully");
    await page.waitForTimeout(2000);

    /* =====================================================
       9️⃣ Open FINAL search page directly
    ===================================================== */
    const searchUrl = `https://www.jiomart.com/search?q=${encodeURIComponent(
      product
    )}`;
    console.log(`🔎 Opening ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    await page.waitForSelector(
      "div[class*=product], li[class*=product]",
      { timeout: 20000 }
    );
    await page.waitForTimeout(2000);

    /* =====================================================
       🔟 Scroll
    ===================================================== */
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 1500);
      await sleep(1200);
    }

    /* =====================================================
       1️⃣1️⃣ Scrape
    ===================================================== */
    console.log("🧮 Scraping products...");
    const products = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll("li.ais-InfiniteHits-item")
      )
        .slice(0, 5) // ✅ LIMIT TO FIRST 5 PRODUCTS
        .map((el) => {
          const name =
            el.querySelector(".plp-card-details-name")?.innerText?.trim() ||
            null;

          const price =
            el.querySelector(".jm-heading-xxs")?.innerText?.trim() ||
            null;

          const mrp =
            el.querySelector(".line-through")?.innerText?.trim() ||
            null;

          const imageEl =
            el.querySelector("img[data-src]") || el.querySelector("img");

          const image =
            imageEl?.getAttribute("data-src") ||
            imageEl?.getAttribute("src") ||
            null;

          const url =
            el.querySelector("a.plp-card-wrapper")?.href || null;

          return {
            title: name,
            price,
            mrp,
            image,
            url,
            platform: "JioMart",
          };
        });
    });


    const finalData = products.filter((p) => p.title).slice(0, 20);
    fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2));
    console.log(`✅ Saved ${finalData.length} products`);
  } catch (err) {
    console.error("❌ JioMart error:", err.message);
  } finally {
    await browser.close();
  }
}

/* =====================================================
   CLI
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
