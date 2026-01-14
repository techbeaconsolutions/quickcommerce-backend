import { runScraper } from "./scrape.service.js";

export const startScrape = async (req, res) => {
  try {
    const { pincode, platforms } = req.body;
    const result = await runScraper(pincode, platforms);
    res.json({ message: "Scraping completed", data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Scraping failed", error: err.message });
  }
};
