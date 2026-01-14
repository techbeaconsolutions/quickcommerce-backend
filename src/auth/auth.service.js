import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/user.model.js";

/* 🔹 Generate OTP */
export const generateOtp = async (email) => {
  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({ email });
  }

  const otp = crypto.randomInt(100000, 999999).toString();

  user.otp = await bcrypt.hash(otp, 10);
  user.otpExpiresAt = Date.now() + 10 * 60 * 1000; // 10 min
  user.otpAttempts = 0;

  await user.save();
  return otp;
};

/* 🔹 Verify OTP */
export const verifyOtp = async (email, enteredOtp) => {
  const user = await User.findOne({ email });
  if (!user) throw "User not found";

  if (!user.otp || Date.now() > user.otpExpiresAt) {
    throw "OTP expired";
  }

  if (user.otpAttempts >= 5) {
    throw "Too many attempts";
  }

  const isValid = await bcrypt.compare(enteredOtp, user.otp);
  if (!isValid) {
    user.otpAttempts += 1;
    await user.save();
    throw "Invalid OTP";
  }

  // ✅ clear OTP after success
  user.otp = null;
  user.otpExpiresAt = null;
  user.otpAttempts = 0;
  await user.save();

  return user;
};
