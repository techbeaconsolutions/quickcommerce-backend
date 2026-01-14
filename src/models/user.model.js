const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,

  // 🔐 OTP
  resetOtp: String,
  resetOtpExpiry: Date,
  otpAttempts: {
    type: Number,
    default: 0,
  },
  lastOtpSentAt: Date,

  // 🔑 Reset token
  resetToken: String,
  resetTokenExpiry: Date,
});

// Hash password only when changed
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

module.exports = mongoose.model("User", userSchema);
