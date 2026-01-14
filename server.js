// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("./src/models/user.model");
const { Queue } = require("bullmq");
const Redis = require("ioredis");
const fs = require("fs");
const path = require("path");

/* =========================
   ENV
========================= */
dotenv.config();

/* =========================
   APP SETUP
========================= */
const app = express();

app.use(cors({
  origin: [
    "http://localhost:8081",
    "http://localhost:5173",
    "https://quickcommerce.duckdns.org",
  ],
  credentials: true,
}));


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

const safeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
});

/* =========================
   REDIS + BULLMQ
========================= */
const redisConnection = new Redis({
  host: "127.0.0.1",
  port: 6379,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const scrapeQueue = new Queue("scrape-all", {
  connection: redisConnection,
});

/* =========================
   SCRAPE ROUTES (TEMP)
========================= */
// TEMP in-memory job store

app.get("/scrape/start", async (req, res) => {
  const { pincode, product } = req.query;

  if (!pincode || !product) {
    return res.status(400).json({
      message: "pincode and product are required",
    });
  }

  try {
    const job = await scrapeQueue.add("scrape-job", {
      pincode,
      product,
    });

    console.log("📥 Job enqueued:", job.id);

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
  const { jobId } = req.params;

  try {
    const job = await scrapeQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        message: "Job not found",
      });
    }

    const state = await job.getState(); // waiting | active | completed | failed

    res.json({
      success: true,
      status: state,
      progress: job.progress || 0,
    });
  } catch (err) {
    console.error("❌ Status error:", err);
    res.status(500).json({
      message: "Failed to fetch job status",
    });
  }
});


// SIGNUP
app.post("/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: "Missing fields" });

    if (password.length < 6)
      return res.status(400).json({ message: "Password too short" });

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists)
      return res.status(400).json({ message: "User already exists" });

    // ✅ DO NOT hash here
    const user = new User({
      name,
      email: email.toLowerCase().trim(),
      password, // plain password
    });

    await user.save(); // 🔥 pre-save hook hashes ONCE

    res.json({ success: true, user: safeUser(user) });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    res.status(500).json({ message: "Signup failed" });
  }
});


// LOGIN
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user)
      return res.status(400).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ success: true, token, user: safeUser(user) });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Login failed" });
  }
});

/* =========================
   SEND OTP (FORGOT PASSWORD)
========================= */
app.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ message: "Email required" });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user)
      return res.status(404).json({ message: "User not found" });

    // Rate limit: 1 OTP / minute
    if (
      user.lastOtpSentAt &&
      Date.now() - user.lastOtpSentAt < 60 * 1000
    ) {
      return res
        .status(429)
        .json({ message: "Wait 1 minute before retry" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.resetOtp = hashOtp(otp);
    user.resetOtpExpiry = Date.now() + 10 * 60 * 1000;
    user.lastOtpSentAt = Date.now();
    user.otpAttempts = 0;

    await user.save();

    await transporter.sendMail({
      from: `"QuickCommerce Support" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Password Reset OTP",
      html: `
        <h2>Password Reset</h2>
        <h1>${otp}</h1>
        <p>Valid for 10 minutes</p>
      `,
    });

    res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("SEND OTP ERROR:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

app.get("/scrape/result", (req, res) => {
  try {
    const filePath = path.join(
      __dirname,
      "results",
      "final-result.json" // ✅ MUST MATCH FILE NAME
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        message: "Result not ready yet",
      });
    }

    const data = fs.readFileSync(filePath, "utf-8");
    res.json(JSON.parse(data));
  } catch (err) {
    console.error("❌ Result read error:", err);
    res.status(500).json({
      message: "Failed to read result",
    });
  }
});

/* =========================
   VERIFY OTP + RESET PASSWORD
========================= */
app.post("/auth/reset-password", async (req, res) => {
  console.log("🔥 RESET PASSWORD ROUTE HIT 🔥");
  console.log("HEADERS:", req.headers);
  console.log("BODY:", req.body);
  try {
    console.log("REQ BODY:", req.body)

    const { resetToken, password } = req.body;

    if (!resetToken || !password) {
      return res.status(400).json({ message: "Missing token or password" });
    }

    const user = await User.findOne({
      resetToken,
      resetTokenExpiry: { $gt: Date.now() },
    });

    console.log("User found:", !!user);

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    user.password = password;
    user.resetToken = null;
    user.resetTokenExpiry = null;

    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error("RESET PASSWORD ERROR:", err);
    res.status(500).json({ message: "Reset failed" });
  }
});


app.post("/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.resetOtp || !user.resetOtpExpiry) {
      return res.status(400).json({ message: "OTP not requested" });
    }

    if (user.resetOtpExpiry < Date.now()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    // 🔐 HASH INPUT OTP AND COMPARE
    const hashedInputOtp = hashOtp(otp);

    if (hashedInputOtp !== user.resetOtp) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // ✅ OTP VERIFIED — CREATE RESET TOKEN
    const resetToken = crypto.randomBytes(32).toString("hex");

    user.resetOtp = null;
    user.resetOtpExpiry = null;
    user.otpAttempts = 0;

    user.resetToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 min

    await user.save();

    return res.json({
      success: true,
      resetToken, // 👈 IMPORTANT
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
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
app.listen(PORT, () =>
  console.log(`🚀 API running on port ${PORT}`)
);
