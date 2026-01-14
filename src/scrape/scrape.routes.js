import express from "express";
import { startScrape } from "./scrape.controller.js";

const router = express.Router();
router.post("/start", startScrape);

export default router;
