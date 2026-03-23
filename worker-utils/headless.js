function safeHeadless(cliHeadless = false) {
  if (!process.env.DISPLAY) return true;
  return cliHeadless !== false;
}

module.exports = { safeHeadless };
