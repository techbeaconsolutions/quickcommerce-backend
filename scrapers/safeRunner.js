// scrapers/safeRunner.js
module.exports.safeRun = async function safeRun(scraperFn, pincode, product) {
  try {
    // Run scraper normally
    const result = await scraperFn(pincode, product);

    // Always return an array (or empty array on fail)
    if (Array.isArray(result)) return result;
    return result ? [result] : [];
  } catch (err) {
    console.error("❌ safeRun error:", err.stack || err.message || err);
    return []; // prevents crashing Promise.all
  }
};
