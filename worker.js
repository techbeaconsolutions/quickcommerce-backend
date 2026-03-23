// worker.js

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
   ⏱ RESULT FILE TTL (AUTO DELETE)
-------------------------------------------------- */
const RESULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/* --------------------------------------------------
   🔴 REDIS (BULLMQ SAFE CONFIG)
-------------------------------------------------- */
const redisConnection = {
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
};

/* --------------------------------------------------
   🔤 NORMALIZATION + MATCHING
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
  const qTokens = normalizeName(query).split(" ").filter(Boolean);
  const nTokens = normalizeName(name).split(" ").filter(Boolean);

  if (!qTokens.length || !nTokens.length) return 0;

  let matched = 0;
  for (const q of qTokens) {
    if (nTokens.includes(q)) matched++;
  }

  return matched / qTokens.length;
}

/* --------------------------------------------------
   📦 HELPERS
-------------------------------------------------- */
function getDisplayName(item) {
  return item.title || item.name || "";
}

function getQuantity(item) {
  return item.qty || item.quantity || null;
}

function getPriceNumber(price) {
  if (!price) return Infinity;
  const num = Number(String(price).replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : Infinity;
}

/* --------------------------------------------------
   🧹 AUTO CLEANUP OLD RESULT FILES
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

// run cleanup on worker boot
cleanupOldResults();

// repeat cleanup every 30 minutes
setInterval(cleanupOldResults, 30 * 60 * 1000);

/* --------------------------------------------------
   🧠 WORKER
-------------------------------------------------- */
const worker = new Worker(
  "search",
  async (job) => {
    const { pincode, product } = job.data;
    const timestamp = new Date().toISOString();

    console.log(`🔍 Job ${job.id} → Searching "${product}" @ ${pincode}`);

    /* ---------------- INIT PROGRESS ---------------- */
    await job.updateProgress({
      percent: 0,
      platforms: {
        blinkit: "pending",
        zepto: "pending",
        jiomart: "pending",
      },
    });

    /* ---------------- SCRAPE BLINKIT ---------------- */
    const blinkData =
      (await safeRun(() => blinkit(pincode, product))) || [];

    await job.updateProgress({
      percent: 33,
      platforms: {
        blinkit: "done",
        zepto: "pending",
        jiomart: "pending",
      },
    });

    /* ---------------- SCRAPE ZEPTO ---------------- */
    const zeptoData =
      (await safeRun(() => zepto(pincode, product))) || [];

    await job.updateProgress({
      percent: 66,
      platforms: {
        blinkit: "done",
        zepto: "done",
        jiomart: "pending",
      },
    });

    /* ---------------- SCRAPE JIOMART ---------------- */
    const jiomartData =
      (await safeRun(() => jiomart(pincode, product))) || [];

    await job.updateProgress({
      percent: 100,
      platforms: {
        blinkit: "done",
        zepto: "done",
        jiomart: "done",
      },
    });

    /* ---------------- RAW PLATFORM DATA ---------------- */
    const rawPlatforms = {
      blinkit: blinkData.slice(0, 10),
      zepto: zeptoData.slice(0, 10),
      jiomart: jiomartData.slice(0, 10),
    };

    /* ---------------- FLATTEN + SCORE ---------------- */
    const allItems = [
      ...rawPlatforms.blinkit.map((i) => ({ ...i, platform: "Blinkit" })),
      ...rawPlatforms.zepto.map((i) => ({ ...i, platform: "Zepto" })),
      ...rawPlatforms.jiomart.map((i) => ({ ...i, platform: "JioMart" })),
    ];

    const scoredItems = allItems.map((item) => {
      const name = getDisplayName(item);
      return {
        ...item,
        normName: normalizeName(name),
        score: similarityScore(product, name),
      };
    });

    /* ---------------- STRICT FILTER ---------------- */
    const STRICT_THRESHOLD = 0.7;
    const hasStrictMatch = scoredItems.some(
      (i) => i.score >= STRICT_THRESHOLD
    );

    const filteredItems = scoredItems
      .filter((i) =>
        hasStrictMatch ? i.score >= STRICT_THRESHOLD : i.score > 0
      )
      .sort((a, b) => b.score - a.score);

      /* ---------------- RANKED RESULTS ---------------- */
const results = filteredItems.map((item, idx) => ({
  name: getDisplayName(item),
  quantity: getQuantity(item),
  platform: item.platform,
  price: item.price,
  image: item.image,
  url: item.url,
  rank: idx + 1,
}));

/* ---------------- SIMILAR PRODUCTS ---------------- */
let similarProducts = [];

if (results.length > 0) {
  const baseProductName = results[0].name;

  similarProducts = filteredItems
    .filter(item => {
      const itemName = getDisplayName(item);
      if (itemName === baseProductName) return false;

      const score = similarityScore(baseProductName, itemName);
      return score >= 0.5;
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

    /* ---------------- LOWEST PRICE ---------------- */
    const lowestPriceProduct =
      results.length === 0
        ? null
        : results.reduce((min, cur) =>
          getPriceNumber(cur.price) < getPriceNumber(min.price)
            ? cur
            : min
        );

    /* ---------------- FINAL RESULT ---------------- */
    const finalResult = {
      pincode,
      product,
      timestamp,
      lowestPriceProduct,
      results,
      similarProducts,   // 👈 ADD THIS
      platforms: rawPlatforms,
    };

    /* 🔑 JOB-SPECIFIC RESULT */
    const outputFile = path.join(
      RESULTS_DIR,
      `result-${job.id}.json`
    );

    fs.writeFileSync(outputFile, JSON.stringify(finalResult, null, 2));

    // /* 🧾 OPTIONAL DEBUG FILE */
    // fs.writeFileSync(
    //   path.join(RESULTS_DIR, "final-result.json"),
    //   JSON.stringify(finalResult, null, 2)
    // );

    return finalResult;
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

/* --------------------------------------------------
   📡 WORKER LIFECYCLE LOGS
-------------------------------------------------- */
worker.on("ready", () => {
  console.log("🟢 Worker ready and waiting for jobs");
});

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed`, err);
});

worker.on("error", (err) => {
  console.error("🔥 Worker error", err);
});

console.log("🚀 Worker booted successfully (search queue)");
