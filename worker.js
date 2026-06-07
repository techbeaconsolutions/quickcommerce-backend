const { Worker } = require("bullmq");
const fs = require("fs");
const path = require("path");

const blinkit = require("./scrapers/blinkit");
const zepto = require("./scrapers/zepto");
const jiomart = require("./scrapers/jiomart");
const { safeRun } = require("./scrapers/safeRunner");

/* --------------------------------------------------
   📂 RESULTS DIR
-------------------------------------------------- */
const RESULTS_DIR = path.join(__dirname, "results");
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

/* --------------------------------------------------
   ⏱ RESULT FILE TTL
-------------------------------------------------- */
const RESULT_TTL_MS = 60 * 60 * 1000;

/* --------------------------------------------------
   🔴 REDIS
-------------------------------------------------- */
const redisConnection = {
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
};

/* --------------------------------------------------
   🔤 NORMALIZATION
-------------------------------------------------- */
function normalizeName(str = "") {
  return str
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(query, name) {
  const q = normalizeName(query);
  const n = normalizeName(name);

  const fruitKeywords = ["banana", "apple", "watermelon", "orange", "guava", "chikoo"];

  if (q === "fruits") {
    if (fruitKeywords.some(k => n.includes(k))) return 1;
  }

  const qTokens = q.split(" ").filter(Boolean);
  const nTokens = n.split(" ").filter(Boolean);

  let matched = 0;
  for (const token of qTokens) {
    if (nTokens.includes(token)) matched++;
  }

  return matched / qTokens.length;
}

/* --------------------------------------------------
   📦 HELPERS
-------------------------------------------------- */
const getDisplayName = (item) => item.title || item.name || "";
const getQuantity = (item) => item.qty || item.quantity || null;

function getPriceNumber(price) {
  if (!price) return Infinity;
  const num = Number(String(price).replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : Infinity;
}

/* --------------------------------------------------
   🧹 CLEANUP
-------------------------------------------------- */
function cleanupOldResults() {
  const now = Date.now();

  fs.readdirSync(RESULTS_DIR).forEach((file) => {
    if (!file.startsWith("result-")) return;

    const filePath = path.join(RESULTS_DIR, file);
    const stats = fs.statSync(filePath);

    if (now - stats.mtimeMs > RESULT_TTL_MS) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Deleted old result: ${file}`);
    }
  });
}

cleanupOldResults();
setInterval(cleanupOldResults, 30 * 60 * 1000);

/* --------------------------------------------------
   🧠 WORKER
-------------------------------------------------- */
const worker = new Worker(
  "search",
  async (job) => {
    const { pincode, product } = job.data;
    const timestamp = new Date().toISOString();

    console.log(`🔍 Job ${job.id} → "${product}" @ ${pincode}`);

    /* ---------- START PROGRESS ---------- */
    await job.updateProgress({
      percent: 10,
      platforms: {
        blinkit: "pending",
        zepto: "pending",
        jiomart: "pending",
      },
    });

    /* ---------- PARALLEL SCRAPING ---------- */
    const results = await Promise.allSettled([
      safeRun(() => blinkit(pincode, product)),
      safeRun(() => zepto(pincode, product)),
      safeRun(() => jiomart(pincode, product)),
    ]);

    const blinkData = results[0].status === "fulfilled" ? results[0].value || [] : [];
    const zeptoData = results[1].status === "fulfilled" ? results[1].value || [] : [];
    const jiomartData = results[2].status === "fulfilled" ? results[2].value || [] : [];

    /* ---------- FINAL PROGRESS ---------- */
    await job.updateProgress({
      percent: 100,
      platforms: {
        blinkit: "done",
        zepto: "done",
        jiomart: "done",
      },
    });

    /* ---------- RAW DATA ---------- */
    const rawPlatforms = {
      blinkit: blinkData.slice(0, 10),
      zepto: zeptoData.slice(0, 10),
      jiomart: jiomartData.slice(0, 10),
    };

    /* ---------- MERGE ---------- */
    const allItems = [
      ...rawPlatforms.blinkit.map((i) => ({ ...i, platform: "Blinkit" })),
      ...rawPlatforms.zepto.map((i) => ({ ...i, platform: "Zepto" })),
      ...rawPlatforms.jiomart.map((i) => ({ ...i, platform: "JioMart" })),
    ];

    const scoredItems = allItems.map((item) => {
      const name = getDisplayName(item);
      return {
        ...item,
        score: similarityScore(product, name),
      };
    });

    const filteredItems = scoredItems
      .filter((i) => i.score >= 0.3)
      .sort((a, b) => b.score - a.score);

    /* ---------- RESULTS ---------- */
    const resultsFinal = filteredItems.map((item, idx) => ({
      name: getDisplayName(item),
      quantity: getQuantity(item),
      platform: item.platform,
      price: item.price,
      image: item.image,
      url: item.url,
      rank: idx + 1,
    }));

    /* ---------- SIMILAR PRODUCTS ---------- */
    let similarProducts = [];

    if (resultsFinal.length > 0) {
      const baseProductName = resultsFinal[0].name;

      similarProducts = filteredItems
        .filter(item => {
          const itemName = getDisplayName(item);
          if (itemName === baseProductName) return false;

          const score = similarityScore(baseProductName, itemName);
          return score < 0.5 && score > 0;
        })
        .slice(0, 6)
        .map(item => ({
          name: getDisplayName(item),
          quantity: getQuantity(item),
          platform: item.platform,
          price: item.price,
          image: item.image,
          url: item.url,
        }));
    }

    /* ---------- LOWEST PRICE ---------- */
    const lowestPriceProduct =
      resultsFinal.length === 0
        ? null
        : resultsFinal.reduce((min, cur) =>
            getPriceNumber(cur.price) < getPriceNumber(min.price)
              ? cur
              : min
          );

    /* ---------- FINAL ---------- */
    const finalResult = {
      pincode,
      product,
      timestamp,
      lowestPriceProduct,
      results: resultsFinal,
      similarProducts,
      platforms: rawPlatforms,
    };

    const outputFile = path.join(
      RESULTS_DIR,
      `result-${job.id}.json`
    );

    fs.writeFileSync(outputFile, JSON.stringify(finalResult, null, 2));

    return finalResult;
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

/* --------------------------------------------------
   📡 LOGS
-------------------------------------------------- */
worker.on("ready", () => console.log("🟢 Worker ready"));
worker.on("completed", (job) => console.log(`✅ Job ${job.id} done`));
worker.on("failed", (job, err) =>
  console.error(`❌ Job ${job?.id} failed`, err)
);
worker.on("error", (err) => console.error("🔥 Worker error", err));

console.log("🚀 Worker running");