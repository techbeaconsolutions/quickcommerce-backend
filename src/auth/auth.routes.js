const express = require("express");
const {
  registerUser,
  loginUser,
  sendOtp,
  verifyOtp,
} = require("./auth.controller");

const router = express.Router();

router.post("/signup", registerUser);
router.post("/login", loginUser);
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

module.exports = router;
