const { Queue } = require("bullmq");
const Redis = require("ioredis");

const connection = new Redis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,   // <-- REQUIRED
  enableReadyCheck: false       // <-- Prevents readiness errors
});


const scrapeQueue = new Queue("scrape-all", { connection });

module.exports = scrapeQueue;
