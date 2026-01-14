// scrapers/jiomart.js
// process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
// process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "0";

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function scrapeJioMart(pincode, product) {
  console.log(`🟦 [JioMart] Starting scraper for ${pincode} | ${product}`);

  const outputDir = path.join(__dirname, "..", "results");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "jiomart-result.json");

  const browser = await chromium.launch({
    headless: true, // keep headless true for the test
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--window-size=1280,800",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-IN",
    geolocation: { latitude: 19.076, longitude: 72.8777 },
    permissions: ["geolocation"],
    viewport: { width: 1280, height: 800 },
  });

  // stealth-ish tweaks
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-IN", "en"],
      });
    } catch (e) {}
  });

  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-IN,en;q=0.9" });

  try {
    // 1) Load homepage
    console.log("🟦 Opening JioMart homepage...");
    await page.goto("https://www.jiomart.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);

    // 2) Try normal locator click
    try {
      const manualLocator = page
        .locator("button", { hasText: "Select Location Manually" })
        .first();
      if (await manualLocator.isVisible().catch(() => false)) {
        console.log("📍 Clicking visible 'Select Location Manually' button...");
        await manualLocator.click();
        await page.waitForTimeout(2000);
      } else {
        console.log(
          "⚠️ Location popup not visible — will try JS injection fallback..."
        );
        await page.evaluate(() => {
          const textCandidates = [
            "Select Location Manually",
            "Select Location",
            "Select Location",
          ];
          const buttons = Array.from(document.querySelectorAll("button"));
          for (const b of buttons) {
            const txt = (b.textContent || "").trim();
            if (textCandidates.some((t) => txt.includes(t))) {
              try {
                b.click();
              } catch (e) {}
              break;
            }
          }
        });
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log("⚠️ popup click attempt error:", e.message);
    }

    // 3) Aggressive strategy to find / fill pincode across normal DOM & shadow DOMs
    console.log(
      `⌨️ Trying to find pincode input (deep search) and type ${pincode}...`
    );
    const fillResult = await page.evaluate(async (pincode) => {
      // helper: deep search including shadow roots
      function queryDeep(selector) {
        const results = [];
        function traverse(node) {
          if (!node) return;
          try {
            if (node.nodeType === 1) {
              if (node.matches && node.matches(selector)) results.push(node);
            }
          } catch (e) {}
          // shadow root
          if (node.shadowRoot) traverse(node.shadowRoot);
          // children
          const children = node.children || [];
          for (let i = 0; i < children.length; i++) traverse(children[i]);
        }
        traverse(document);
        return results;
      }

      // try multiple selector patterns
      const candidateSelectors = [
        'input[placeholder*="Pin code"]',
        'input[placeholder*="Pin"]',
        'input[placeholder*="area"]',
        'input[placeholder*="Search for area"]',
        'input[type="text"]',
        "input",
      ];

      // 1) search with placeholders
      for (const sel of candidateSelectors) {
        const els = queryDeep(sel);
        if (els && els.length) {
          // pick the first visible-like element
          for (const el of els) {
            try {
              // attempt to focus and set value with events
              el.focus();
              el.value = pincode;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.blur();
              return {
                ok: true,
                method: "deep-fill",
                selector: sel,
                text: el.outerHTML?.slice(0, 200) || "",
              };
            } catch (e) {}
          }
        }
      }

      // 2) fallback: search any input and try to pattern match nearby labels
      const all = queryDeep("input");
      for (const inp of all) {
        try {
          // ignore password/hidden/disabled
          if (inp.type && (inp.type === "password" || inp.type === "hidden"))
            continue;
          inp.focus();
          inp.value = pincode;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          inp.blur();
          return {
            ok: true,
            method: "any-input-fill",
            tag: inp.outerHTML?.slice(0, 200) || "",
          };
        } catch (e) {}
      }

      // 3) last resort: try to set window.localStorage / cookies to hint pincode (non-invasive)
      try {
        localStorage.setItem("selectedPincode", pincode);
        localStorage.setItem("deliveryLocationSet", "true");
        return { ok: false, hint: "used-localStorage-fallback" };
      } catch (e) {}

      return { ok: false, error: "no-input-found" };
    }, pincode);

    if (!fillResult || !fillResult.ok) {
      console.log("⚠️ Deep pincode fill failed:", fillResult);
    } else {
      console.log(
        "✅ Deep pincode fill result:",
        fillResult.method || fillResult
      );
    }

    // If we filled the pincode via JS, try pressing Enter and clicking confirm
    try {
      await page.keyboard.press("ArrowDown").catch(() => {});
      await page.keyboard.press("Enter").catch(() => {});
      await page.waitForTimeout(2000);
    } catch (e) {}

    // click confirm if visible
    try {
      const confirmBtn = page
        .locator("button", { hasText: "Confirm Location" })
        .first();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
        console.log("✅ Confirm Location clicked");
        await page.waitForTimeout(3000);
      }
    } catch (e) {}

    // 4) Reload homepage to ensure location applied
    await page.goto("https://www.jiomart.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    // 5) Search product (with retries)
    console.log(`🔎 Searching for "${product}"...`);
    let searchOk = false;
    for (let attempt = 1; attempt <= 4 && !searchOk; attempt++) {
      try {
        await page.waitForSelector("input[placeholder*='Search']", {
          timeout: 7000,
        });
        await page.fill("input[placeholder*='Search']", product);
        await page.keyboard.press("Enter");
        searchOk = true;
        console.log("✅ Search initiated");
      } catch (e) {
        console.log(
          `⚠️ Search field not available (attempt ${attempt}), retrying...`
        );
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }
    if (!searchOk) {
      await page.screenshot({
        path: path.join(outputDir, "jiomart_no_search_final.png"),
        fullPage: true,
      });
      throw new Error("Search input unavailable after retries");
    }

    // scroll & scrape
    console.log("⬇️ Scrolling product list...");
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(900);
    }
    await page.waitForTimeout(2000);

    console.log("🧮 Scraping visible products...");
    const products = await page.evaluate(() => {
      const selectors = [
        ".jm-product-card",
        ".ais-InfiniteHits-item",
        ".cat-item",
        ".plp-card",
      ];
      const elements = document.querySelectorAll(selectors.join(","));
      return Array.from(elements).map((el) => {
        const title =
          el
            .querySelector(".clsgetname, .title, h2, .name, .product-name")
            ?.innerText?.trim() || null;
        const price =
          el
            .querySelector(".final-price, .prod_price, .price, .jm-price")
            ?.innerText?.trim() || null;
        const quantity =
          el
            .querySelector(".clsgetsize, .unit, .weight, .pkg")
            ?.innerText?.trim() || null;
        const image = el.querySelector("img")?.src || null;
        return { title, price, quantity, image, platform: "JioMart" };
      });
    });

    const finalData = Array.isArray(products) ? products.slice(0, 20) : [];
    if (!finalData.length) {
      console.log("⚠️ No products scraped — saving debug screenshot.");
      await page.screenshot({
        path: path.join(outputDir, "jiomart_no_products.png"),
        fullPage: true,
      });
    }

    fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2), "utf-8");
    console.log(
      `✅ [JioMart] Saved ${finalData.length} products → ${outputPath}`
    );
  } catch (err) {
    console.error("❌ JioMart scraper error:", err.message);
    try {
      await page.screenshot({
        path: path.join(outputDir, `jiomart_error_${Date.now()}.png`),
        fullPage: true,
      });
    } catch (e) {}
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const [pincode, product] = process.argv.slice(2);
  if (!pincode || !product) {
    console.log("Usage: node scrapers/jiomart.js <PINCODE> <PRODUCT>");
    process.exit(1);
  }
  scrapeJioMart(pincode, product);
}

module.exports = scrapeJioMart;
