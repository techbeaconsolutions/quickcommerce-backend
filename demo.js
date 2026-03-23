const readline = require("readline");
const fs = require("fs");
const path = require("path");

const blinkit = require("./scrapers/blinkit");
const zepto = require("./scrapers/zepto");
const jiomart = require("./scrapers/jiomart");
const { matchProducts } = require("./utils/productMatcher");

/* =====================================================
   🧠 Get input from user if not passed via CLI
===================================================== */
async function getInputFromUser() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const pincode = await new Promise((res) =>
    rl.question("📍 Enter PINCODE: ", res)
  );
  const product = await new Promise((res) =>
    rl.question("🔍 Enter product name: ", res)
  );

  rl.close();
  return { pincode: pincode.trim(), product: product.trim() };
}

/* =====================================================
   🧹 Utility to clear old JSON files
===================================================== */
function clearOldResults() {
  const resultDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }

  const files = [
    "blinkit-result.json",
    "zepto-result.json",
    "jiomart-result.json",
    "final-matches.json",
    "all-platforms.json",
  ];

  console.log("🧹 Cleaning old result files...");

  for (const file of files) {
    const filePath = path.join(resultDir, file);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
      console.log(`🗑️ Deleted old file: ${file}`);
    }
  }

  console.log("✅ Cleanup completed.\n");
}

/* =====================================================
   📊 Summarize & merge platform results
===================================================== */
function summarizeAndMerge({ blinkit, zepto, jiomart }) {
  const resultDir = path.join(__dirname, "results");
  const unifiedPath = path.join(resultDir, "all-platforms.json");

  const datasets = [
    { name: "Blinkit", data: blinkit },
    { name: "Zepto", data: zepto },
    { name: "JioMart", data: jiomart }, // ✅ FIXED casing
  ];

  const summary = [];

  for (const { name, data } of datasets) {
    if (!Array.isArray(data) || data.length === 0) {
      summary.push({ platform: name, count: 0, avg: "-", min: "-" });
      continue;
    }

    const prices = data
      .map((p) =>
        parseFloat(String(p.price || "").replace(/[₹,\s]/g, ""))
      )
      .filter((n) => !isNaN(n));

    const avg =
      prices.length > 0
        ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
        : "-";

    const min = prices.length > 0 ? Math.min(...prices) : "-";

    summary.push({
      platform: name,
      count: data.length,
      avg,
      min,
    });
  }

  const all = [
    ...(blinkit || []),
    ...(zepto || []),
    ...(jiomart || []),
  ];

  fs.writeFileSync(unifiedPath, JSON.stringify(all, null, 2), "utf-8");

  console.log("\n📊 Platform Summary:");
  console.log("──────────────────────────────────────────────");
  console.log("Platform     | Products | Avg Price | Lowest");
  console.log("──────────────────────────────────────────────");

  for (const s of summary) {
    console.log(
      `${s.platform.padEnd(12)} | ${String(s.count).padEnd(8)} | ₹${String(
        s.avg
      ).padEnd(9)} | ₹${s.min}`
    );
  }

  console.log("──────────────────────────────────────────────");
  console.log(`💾 Unified results saved → ${unifiedPath}`);
}

/* =====================================================
   🏁 Main runner
===================================================== */
async function main() {
  try {
    let [pincode, product] = process.argv.slice(2);

    if (!pincode || !product) {
      const input = await getInputFromUser();
      pincode = input.pincode;
      product = input.product;
    }

    if (!pincode || !product) {
      console.log("❌ PINCODE and product are required.");
      return;
    }

    clearOldResults();

    console.log(
      `🚀 Starting scrapers for "${product}" at PINCODE ${pincode}...\n`
    );

    const [blinkitData, zeptoData, jiomartData] =
      await Promise.allSettled([
        blinkit(pincode, product),
        zepto(pincode, product),
        jiomart(pincode, product),
      ]);

    const blinkitResult =
      blinkitData.status === "fulfilled" ? blinkitData.value : [];
    const zeptoResult =
      zeptoData.status === "fulfilled" ? zeptoData.value : [];
    const jiomartResult =
      jiomartData.status === "fulfilled" ? jiomartData.value : [];

    if (
      blinkitResult.length === 0 &&
      zeptoResult.length === 0 &&
      jiomartResult.length === 0
    ) {
      console.log(
        `🚫 No data found for "${product}" at PINCODE ${pincode}.`
      );
      return;
    }

    console.log(`✅ Blinkit Results: ${blinkitResult.length}`);
    console.log(`✅ Zepto Results: ${zeptoResult.length}`);
    console.log(`✅ JioMart Results: ${jiomartResult.length}`);

    const activePlatforms = [
      blinkitResult.length && "Blinkit",
      zeptoResult.length && "Zepto",
      jiomartResult.length && "JioMart",
    ].filter(Boolean);

    console.log(`🟢 Active platforms: ${activePlatforms.join(", ")}`);

    if (activePlatforms.length >= 2) {
      console.log("\n🔄 Matching products using text similarity...");
      await matchProducts();
      console.log(
        "✅ Matching completed → results/final-matches.json\n"
      );

      summarizeAndMerge({
        blinkit: blinkitResult,
        zepto: zeptoResult,
        jiomart: jiomartResult,
      });
    } else {
      console.log(
        "⚠️ Skipping matching — need at least 2 platforms with data."
      );
    }
  } catch (err) {
    console.error("❌ Error running scrapers:", err);
  }
}

main();
