import puppeteer from "puppeteer";

let browser;

export async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox"],
    });
  }
  return browser;
}

export async function newPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(30000);
  return page;
}
