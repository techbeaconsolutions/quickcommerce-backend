const RESULTS_DIR = "/root/quickcommerce-backend/results";

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { Queue } = require("bullmq");
const Redis = require("ioredis");
const fs = require("fs");
const path = require("path");

// 🔐 AUTH ROUTES
const authRoutes = require("./src/auth/auth.routes");

/* =========================
   ENV
========================= */
dotenv.config();

/* =========================
   APP SETUP
========================= */
const app = express();

/* =========================
   CORS (FIXED – PRE-FLIGHT SAFE)
========================= */
const corsOptions = {
  origin: [
    "http://localhost:8081",
    "http://localhost:5173",
    "https://quickcommerce.duckdns.org",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization","cache-control",],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // 🔥 REQUIRED FOR PREFLIGHT

app.use(express.json());

/* =========================
   DATABASE
========================= */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Error:", err));

/* =========================
   EMAIL
========================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((err) => {
  if (err) console.error("❌ Email Error:", err);
  else console.log("✅ Email Ready");
});

/* =========================
   HELPERS
========================= */
const hashOtp = (otp) =>
  crypto.createHash("sha256").update(otp).digest("hex");

/* =========================
   REDIS + BULLMQ
========================= */
const redisConnection = new Redis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const searchQueue = new Queue("search", {
  connection: redisConnection,
});

/* =========================
   AUTH ROUTES (MUST BE BEFORE LISTEN)
========================= */
app.use("/auth", authRoutes);

/* =========================
   SCRAPE ROUTES
========================= */
app.get("/scrape/start", async (req, res) => {
  const { pincode, product } = req.query;

  if (!pincode || !product) {
    return res.status(400).json({
      message: "pincode and product are required",
    });
  }

  try {
    const job = await searchQueue.add("scrape-job", {
      pincode,
      product,
    });

    res.json({
      success: true,
      jobId: job.id,
    });
  } catch (err) {
    console.error("❌ Failed to enqueue job:", err);
    res.status(500).json({
      message: "Failed to start scraping",
    });
  }
});

app.get("/scrape/status/:jobId", async (req, res) => {
  const job = await searchQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ message: "Job not found" });

  const state = await job.getState();
  res.json({
    success: true,
    status: state,
    progress: job.progress || { percent: 0, platforms: {} },
  });
});

app.get("/scrape/result/:jobId", (req, res) => {
  const filePath = path.join(
    RESULTS_DIR,
    `result-${req.params.jobId}.json`
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      status: "WAITING",
      message: "Result not ready yet",
    });
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  res.json({ status: "DONE", data });
});

/* =========================
   HEALTH
========================= */
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

/* =========================
   START SERVER
========================= */
const PORT = 10000;
app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
});
