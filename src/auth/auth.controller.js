const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const transporter = require("../utils/mailer");

/* ======================
   REGISTER
====================== */
const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password,
    });

    res.status(201).json({
      success: true,
      message: "User created",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });

  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/* ======================
   LOGIN
====================== */
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.password) {
      return res.status(400).json({
        message: "Password not set. Please complete signup.",
      });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
};


/* ======================
   SEND OT
====================== */
const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    let user = await User.findOne({ email });
    if (!user) user = await User.create({ email });

    const otp = crypto.randomInt(100000, 999999).toString();

    user.otp = await bcrypt.hash(otp, 10);
    user.otpExpiresAt = Date.now() + 10 * 60 * 1000;
    user.otpAttempts = 0;
    await user.save();

    await transporter.sendMail({
      from: `"QuickCommerce" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your OTP for QuickCommerce",
      html: `
        <h2>OTP Verification</h2>
        <h1>${otp}</h1>
        <p>Valid for 10 minutes</p>
      `,
    });

    res.json({ message: "OTP sent successfully" });
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

/* ======================
   VERIFY OTP
====================== */
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.otp || Date.now() > user.otpExpiresAt) {
      return res.status(400).json({ message: "OTP expired" });
    }

    if (user.otpAttempts >= 5) {
      return res.status(400).json({ message: "Too many attempts" });
    }

    const valid = await bcrypt.compare(otp, user.otp);
    if (!valid) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json({ message: "Invalid OTP" });
    }

    user.otp = null;
    user.otpExpiresAt = null;
    user.otpAttempts = 0;
    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ message: "OTP verified", token });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ message: "OTP verification failed" });
  }
};

module.exports = {
  registerUser,
  loginUser,
  sendOtp,
  verifyOtp,
};
