import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./fixture-data";

/** Types a UID the way a USB keyboard-wedge reader does: a fast burst, then Enter. */
async function usbTap(page: Page, uid: string) {
  // Dispatched in one burst inside the page, like real reader hardware (no test-runner round trips between keys).
  await page.evaluate((text) => {
    for (const key of [...text, "Enter"]) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }, uid);
}

async function connectKiosk(page: Page) {
  const f = fixture();
  await page.goto("/kiosk");
  await expect(page.getByRole("heading", { name: "Set up this kiosk" })).toBeVisible();
  await page.getByLabel("Device token").fill(f.deviceToken);
  await page.getByRole("button", { name: "Connect kiosk" }).click();
  await expect(page.getByText(f.schoolName)).toBeVisible();
  await page.getByRole("button", { name: "Start scanning" }).click();
  await expect(page.getByText("Tap your ID card")).toBeVisible();
}

test.describe("kiosk", () => {
  test.describe.configure({ mode: "serial" });

  test("asks for a device token and rejects a wrong one", async ({ page }) => {
    await page.goto("/kiosk");
    await page.getByLabel("Device token").fill("tapin_dev_thisisnotarealtokenatall123");
    await page.getByRole("button", { name: "Connect kiosk" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText(/isn't valid|didn't work/);
  });

  test("idle screen, then a tap shows the photo screen and returns to idle", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "one sign-in per run");
    const f = fixture();
    await connectKiosk(page);
    await expect(page.getByText("E2E Gate")).toBeVisible();

    await usbTap(page, f.kioskStudent.uid);
    const result = page.getByRole("status").filter({ hasText: f.kioskStudent.name });
    await expect(result).toBeVisible();
    await expect(result).toContainText(/Signed in/);
    await expect(result).toContainText(f.className);
    await expect(page.getByText("Tap your ID card")).toBeVisible({ timeout: 6000 }); // back to idle after 3 s

    // Same card again straight away: duplicate, not a second sign-in.
    await usbTap(page, f.kioskStudent.uid);
    await expect(page.getByRole("status").filter({ hasText: f.kioskStudent.name })).toContainText(/Already/);
  });

  test("unknown card shows the red screen", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop");
    await connectKiosk(page);
    await usbTap(page, "DEADBEEF");
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("Card not recognised");
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("Please see the admin office");
  });

  test("offline taps are saved and sent when the connection returns", async ({ page, context }, info) => {
    test.skip(info.project.name !== "laptop");
    await connectKiosk(page);
    await context.setOffline(true);
    await usbTap(page, "0A0B0C0D0E0F");
    await expect(page.getByText("Tap saved")).toBeVisible();
    await expect(page.getByText(/Offline — taps are being saved \(1\)/)).toBeVisible();
    // Survives a reload (stored on the device)
    const stored = await page.evaluate(() => localStorage.getItem("tapin.kiosk.queue.v1"));
    expect(JSON.parse(stored!)).toHaveLength(1);
    expect(stored).not.toMatch(/name|phone|photo/i); // only card numbers are kept offline

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText(/Offline — taps are being saved/)).toBeHidden({ timeout: 20_000 });
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("tapin.kiosk.queue.v1")))!)).toHaveLength(0);
  });

  test("never shows lists of students or phone numbers", async ({ page }) => {
    await connectKiosk(page);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\+234|0803|Chioma|David/);
  });
});
