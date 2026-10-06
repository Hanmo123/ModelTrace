import { readFile } from "node:fs/promises";

// Routing/UI regressions assert all three requests. Upstream refits can otherwise
// make their fixed mock answers hit 99% early and change the expected call counts.
// Only intercept the bank in these tests; retain the current models/artifacts.
// Actual-bank attribution is covered by bank-test/core-test; early stop by runner/static tests.
export async function useLowConfidenceBank(page) {
  const bank = JSON.parse(
    await readFile(
      new URL("../public/data/unified_bank.json", import.meta.url),
      "utf8",
    ),
  );
  for (const calibration of Object.values(bank.calibration))
    calibration.beta = 0.01;
  const body = JSON.stringify(bank);
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/data/unified_bank.json")) {
      void request.respond({
        status: 200,
        contentType: "application/json",
        body,
      });
    } else {
      void request.continue();
    }
  });
}
