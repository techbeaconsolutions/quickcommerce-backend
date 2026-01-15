const { Worker } = require("bullmq");
const Redis = require("ioredis");
const fs = require("fs");
const path = require("path");

const blinkit = require("./scrapers/blinkit");
const zepto = require("./scrapers/zepto");
const jiomart = require("./scrapers/jiomart");
const swiggy = require("./scrapers/swiggy");
const { safeRun } = require("./scrapers/safeRunner");
const { ensureXvfb } = require("./utils/xvfb");

const connection = new Redis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

console.log("👷 Worker starting...");

(async () => {
  await ensureXvfb();
  console.log("🖥️ Xvfb ready");

  new Worker(
    "scrape-all",
    async (job) => {
      const { pincode, product } = job.data;
      console.log(`🔄 Scraping ${product} for ${pincode}`);

      await job.updateProgress(10);

      const [blinkData, zeptoData, jiomartData, swiggyData] = await Promise.all([
        safeRun(() => blinkit(pincode, product)),
        safeRun(() => zepto(pincode, product)),
        safeRun(() => jiomart(pincode, product)),
        safeRun(() => swiggy(pincode, product)),
      ]);

      await job.updateProgress(70);

      const all = [
        ...(blinkData || []),
        ...(zeptoData || []),
        ...(jiomartData || []),
        ...(swiggyData || []),
      ];

      const toNum = (price) =>
        parseFloat(String(price || "").replace(/[₹,\s]/g, "")) || Infinity;

      // 🔹 Merge + clean
      const merged = [
        ...(blinkData || []),
        ...(zeptoData || []),
        ...(jiomartData || []),
        ...(swiggyData || []),
      ].filter(item => item.price && toNum(item.price) !== Infinity);

      // 🔹 Sort by price
      const sorted = merged.sort((a, b) => toNum(a.price) - toNum(b.price));

      // 🔹 Global ranking + cleanup
      sorted.forEach((item, index) => {
        delete item.pos;        // remove scraper-specific position
        item.rank = index + 1; // global rank
      });

      const finalOutput = {
        jobId: job.id,
        pincode,
        product,
        timestamp: new Date().toISOString(),
        lowestPriceProduct: sorted[0] || null,
        results: sorted,
        platforms: {
          blinkit: blinkData,
          zepto: zeptoData,
          jiomart: jiomartData,
          swiggy: swiggyData,
        },
      };

      // ✅ Latest-result-only file (intentional overwrite)
      const savePath = path.join(__dirname, "results", "final-result.json");
      fs.writeFileSync(savePath, JSON.stringify(finalOutput, null, 2));
      await job.updateProgress(100);
      console.log("✅ Job completed:", job.id);

      return finalOutput;
    },
    { connection }
  );

  console.log("👷 Worker listening for jobs");
})();
