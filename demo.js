const readline = require("readline");
const fs = require("fs");
const path = require("path");
const blinkit = require("./scrapers/blinkit");
const zepto = require("./scrapers/zepto");
const jiomart = require("./scrapers/jiomart");
const swiggy = require("./scrapers/swiggy");
const { matchProducts } = require("./utils/productMatcher");

// 🧠 Get input from user if not passed via CLI
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
  return { pincode, product };
}

// 🧹 Utility to clear old JSON files
function clearOldResults() {
  const resultDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir, { recursive: true });

  const files = [
    "blinkit-result.json",
    "zepto-result.json",
    "jiomart-result.json",
    "swiggy-result.json",
    "final-matches.json",
    "all-platforms.json",
  ];

  console.log("🧹 Cleaning old result files...");

  for (const file of files) {
    const filePath = path.join(resultDir, file);
    try {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        console.log(`🗑️ Deleted old file: ${file}`);
      } else {
        console.log(`⚠️ File not found (skipped): ${file}`);
      }
    } catch (err) {
      console.error(`❌ Error deleting ${file}:`, err.message);
    }
  }

  console.log("✅ Cleanup completed.\n");
}

// 📊 Create unified results + print platform summary
function summarizeAndMerge({ blinkit, zepto, jiomart, swiggy }) {
  const resultDir = path.join(__dirname, "results");
  const unifiedPath = path.join(resultDir, "all-platforms.json");

  const datasets = [
    { name: "Blinkit", data: blinkit },
    { name: "Zepto", data: zepto },
    { name: "Jiomart", data: jiomart },
    { name: "Swiggy", data: swiggy },
  ];

  const summary = [];

  for (const { name, data } of datasets) {
    if (!data?.length) {
      summary.push({ platform: name, count: 0, avg: "-", min: "-" });
      continue;
    }

    // Extract numeric prices (remove ₹ and convert to numbers)
    const prices = data
      .map((p) => parseInt(String(p.price).replace(/[^\d]/g, ""), 10))
      .filter((n) => !isNaN(n));

    const avg =
      prices.length > 0
        ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
        : "-";
    const min = prices.length > 0 ? Math.min(...prices) : "-";

    summary.push({ platform: name, count: data.length, avg, min });
  }

  // 💾 Save unified dataset
  const all = [...(blinkit || []), ...(zepto || []), ...(jiomart || []), ...(swiggy || [])];
  fs.writeFileSync(unifiedPath, JSON.stringify(all, null, 2), "utf-8");

  // 📊 Print Summary
  console.log(`\n📊 Platform Summary:`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`Platform     | Products | Avg Price | Lowest`);
  console.log(`──────────────────────────────────────────────`);
  for (const s of summary) {
    console.log(
      `${s.platform.padEnd(12)} | ${String(s.count).padEnd(8)} | ₹${String(
        s.avg
      ).padEnd(9)} | ₹${s.min}`
    );
  }
  console.log(`──────────────────────────────────────────────`);
  console.log(`💾 Unified results saved → ${unifiedPath}`);
}

// 🏁 Main function
async function main() {
  try {
    let [pincode, product] = process.argv.slice(2);
    if (!pincode || !product) {
      const input = await getInputFromUser();
      pincode = input.pincode;
      product = input.product;
    }

    // Step 1: Clean old results
    clearOldResults();

    console.log(
      `🚀 Starting scrapers for "${product}" at PINCODE ${pincode}...`
    );

    // Step 2: Run all scrapers concurrently
    const [blinkitData, zeptoData, jiomartData, swiggyData] = await Promise.allSettled([
      blinkit(pincode, product),
      zepto(pincode, product),
      jiomart(pincode, product),
      swiggy(pincode, product),
    ]);

    const blinkitResult =
      blinkitData.status === "fulfilled" ? blinkitData.value : [];
    const zeptoResult = zeptoData.status === "fulfilled" ? zeptoData.value : [];
    const jiomartResult = jiomartData.status === "fulfilled" ? jiomartData.value : [];
    const swiggyResult =
      swiggyData.status === "fulfilled" ? swiggyData.value : [];

    // Step 3: Handle missing data
    if (!blinkitResult.length && !zeptoResult.length && !jiomartResult.length && !swiggyResult.length) {
      console.log(
        `🚫 No data found for "${product}" at PINCODE ${pincode} on any platform.`
      );
      return;
    }

    if (!blinkitResult.length) console.log("⚠️ Blinkit returned no products.");
    if (!zeptoResult.length) console.log("⚠️ Zepto returned no products.");
    if (!jiomartResult.length) console.log("⚠️ Jiomart returned no products.");
    if (!swiggyResult.length) console.log("⚠️ Swiggy returned no products.");

    console.log(`\n✅ Blinkit Results: ${blinkitResult.length}`);
    console.log(`✅ Zepto Results: ${zeptoResult.length}`);
    console.log(`✅ Jiomart Results: ${jiomartResult.length}`);
    console.log(`✅ Swiggy Results: ${swiggyResult.length}`);

    // Step 4: Match products if 2 or more have results
    const activePlatforms = [blinkitResult, zeptoResult, jiomartResult, swiggyResult].filter(
      (d) => d.length > 0
    );

    if (activePlatforms.length >= 2) {
      console.log("\n🔄 Matching products using text similarity...");
      await matchProducts();
      console.log(
        "\n✅ Matching completed. Check 'results/final-matches.json'."
      );

      // 📊 Generate summary and unified dataset
      summarizeAndMerge({
        blinkit: blinkitResult,
        zepto: zeptoResult,
        jiomart: jiomartResult,
        swiggy: swiggyResult,
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

// 🏁 Run main
main();
