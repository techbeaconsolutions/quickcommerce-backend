import User from "../models/user.model.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: "User already exists" });

    const user = await User.create({ name, email, password });
    res.status(201).json({ message: "User created", user });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "Login successful", token });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error });
  }
};


/* ======================
   SEND OTP
====================== */
export const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email }); // passwordless user
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    user.otp = await bcrypt.hash(otp, 10);
    user.otpExpiresAt = Date.now() + 10 * 60 * 1000; // 10 min
    user.otpAttempts = 0;

    await user.save();

    // TODO: send email (nodemailer)
    console.log("OTP:", otp); // TEMP (remove later)

    res.json({ message: "OTP sent successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to send OTP" });
  }
};

/* ======================
   VERIFY OTP & LOGIN
====================== */
export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

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

    // ✅ OTP success → clear OTP
    user.otp = null;
    user.otpExpiresAt = null;
    user.otpAttempts = 0;
    await user.save();

    // 🔐 ISSUE JWT (LOGIN)
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "OTP verified & login successful",
      token,
    });
  } catch (error) {
    res.status(500).json({ message: "OTP verification failed" });
  }
};