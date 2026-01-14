import express from "express";
import {
  registerUser,
  loginUser,
  sendOtp,
  verifyOtp,
} from "./auth.controller.js";

const router = express.Router();

router.post("/signup", registerUser);
router.post("/login", loginUser);
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

export default router;
