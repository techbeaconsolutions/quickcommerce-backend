import { exec } from "child_process";
import util from "util";
const execPromise = util.promisify(exec);

export const runScraper = async (pincode, platforms) => {
  const outputs = {};

  for (const platform of platforms) {
    const scriptPath = `./scrapers/${platform}.js`;
    console.log(`Running ${platform} scraper for ${pincode}...`);

    const { stdout, stderr } = await execPromise(`node ${scriptPath} ${pincode}`);
    if (stderr) console.error(stderr);
    outputs[platform] = stdout || "Done";
  }

  return outputs;
};
