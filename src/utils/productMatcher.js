const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");

// 🧩 Phase 1 – Basic Normalization
function normalizeName(name) {
  return name
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// 🧩 Phase 2 – Safe Price Parsing
function parsePrice(priceStr) {
  if (priceStr === undefined || priceStr === null) return null;
  const str = String(priceStr).trim();

  const match = str.match(/₹\s?(\d+(\.\d+)?)/);
  if (match) return parseFloat(match[1]);

  const digits = str.match(/\d+(\.\d+)?/);
  return digits ? parseFloat(digits[0]) : null;
}

// 🧩 Phase 3 – Brand Normalization
function detectBrand(title = "") {
  const knownBrands = [
    "Amul",
    "Gowardhan",
    "Mother Dairy",
    "Desi Farms",
    "Pride of Cows",
    "Milky Mist",
    "Humpy Farms",
    "iD",
    "Nestle",
    "Tata",
    "Britannia",
    "Kurkure",
    "Lays",
    "Parle",
    "Patanjali",
    "Cadbury",
    "Bisleri",
    "Milton",
    "Cello",
    "Speedex",
    "Aquafina",
    "Kinley",
  ];

  const found = knownBrands.find((b) =>
    title.toLowerCase().includes(b.toLowerCase())
  );
  return found || "Generic";
}

// 🧠 Phase 4 – Multi-Platform Matching
async function matchProducts() {
  const resultsDir = path.join(__dirname, "../results");
  const blinkitPath = path.join(resultsDir, "blinkit-result.json");
  const zeptoPath = path.join(resultsDir, "zepto-result.json");
  const jiomartPath = path.join(resultsDir, "jiomart-result.json");

  const readJSON = (file) =>
    fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : [];

  const blinkitData = readJSON(blinkitPath);
  const zeptoData = readJSON(zeptoPath);
  const jiomartData = readJSON(jiomartPath);

  if (!blinkitData.length && !zeptoData.length && !jiomartData.length) {
    console.log("⚠️ No platform data available to match.");
    return;
  }

  console.log(`📦 Blinkit Products: ${blinkitData.length}`);
  console.log(`🛒 Zepto Products: ${zeptoData.length}`);
  console.log(`🏬 JioMart Products: ${jiomartData.length}`);

  // --- Normalize names, detect brands, and sanitize
  [blinkitData, zeptoData, jiomartData].forEach((dataset) =>
    dataset.forEach((p) => {
      const title = p.name || p.title;
      if (!title) return; // skip empty titles
      p._norm = normalizeName(title);
      p.brand = detectBrand(title);
      p._priceNum = parsePrice(p.price);
    })
  );

  // --- Combine all datasets
  const all = [
    ...blinkitData.map((p) => ({ ...p, platform: "Blinkit" })),
    ...zeptoData.map((p) => ({ ...p, platform: "Zepto" })),
    ...jiomartData.map((p) => ({ ...p, platform: "JioMart" })),
  ].filter((p) => p._norm); // skip missing names

  const fuse = new Fuse(all, {
    includeScore: true,
    threshold: 0.35,
    keys: ["_norm"],
  });

  const matches = [];
  const brands = [...new Set(all.map((p) => p.brand))];

  for (const brand of brands) {
    const brandItems = all.filter((p) => p.brand === brand);
    if (brandItems.length < 2) continue;

    const base = brandItems[0];
    const related = fuse.search(brand.toLowerCase()).map((r) => r.item);

    const byPlatform = {};
    for (const r of related) {
      if (!byPlatform[r.platform]) byPlatform[r.platform] = r;
    }

    const platforms = Object.keys(byPlatform);
    if (platforms.length < 2) continue;

    matches.push({
      brand,
      baseProduct: base.name || base.title,
      results: platforms.map((plat) => ({
        platform: plat,
        title: byPlatform[plat].name || byPlatform[plat].title,
        price: byPlatform[plat].price,
      })),
    });
  }

  const outputPath = path.join(resultsDir, "final-matches.json");
  fs.writeFileSync(outputPath, JSON.stringify(matches, null, 2));
  console.log(`💾 Multi-platform matches saved → ${outputPath}`);
}

module.exports = { matchProducts };
