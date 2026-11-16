import { randomBytes, scryptSync } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
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
    await expect(page.getByRole("button", { name: "Test sound" })).toBeVisible();

    await usbTap(page, f.kioskStudent.uid);
    const result = page.getByRole("status").filter({ hasText: f.kioskStudent.name });
    await expect(result).toBeVisible();
    await expect(result).toContainText(/Signed in/);
    await expect(result).toContainText(f.className);
    await page.screenshot({ path: "test-results/kiosk-result.png" });
    await expect(page.getByText("Tap your ID card")).toBeVisible({ timeout: 8000 }); // back to idle after 4 s

    // Same card again straight away: duplicate, not a second sign-in.
    await usbTap(page, f.kioskStudent.uid);
    await expect(page.getByRole("status").filter({ hasText: f.kioskStudent.name })).toContainText(/Already/);
  });

  test("on an NFC phone, Start scanning asks for NFC before going full screen", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "pretends to be an Android phone with NFC");
    // A stand-in for Chrome's NFC reader that records the order of calls. Going full screen first uses up the
    // tap, and Chrome then refuses NFC without asking (seen on a Samsung).
    await page.addInitScript(() => {
      const w = window as unknown as { __calls: string[]; NDEFReader: unknown };
      w.__calls = [];
      w.NDEFReader = class { onreading = null; onreadingerror = null; async scan() { w.__calls.push("nfc"); } };
      const original = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = function (...args) { w.__calls.push("fullscreen"); return original.apply(this, args).catch(() => {}); };
    });
    const f = fixture();
    await page.goto("/kiosk");
    await page.getByLabel("Device token").fill(f.deviceToken);
    await page.getByRole("button", { name: "Connect kiosk" }).click();
    await page.getByRole("button", { name: "Start scanning" }).click();
    await expect(page.getByText("Listening for cards")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls)).toEqual(["nfc", "fullscreen"]);
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

  test("opens with no internet after one online visit (power cut at the gate)", async ({ page, context }, info) => {
    test.skip(info.project.name !== "laptop");
    const f = fixture();
    await connectKiosk(page);
    // Wait until the service worker controls the page and has cached it.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByText(f.schoolName)).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("button", { name: "Start scanning" })).toBeVisible();
    await expect(page.getByText(f.schoolName)).toBeVisible(); // remembered on the device
    await expect(page.getByText(/Offline/)).toBeVisible();
    await context.setOffline(false);
  });

  test("never shows lists of students or phone numbers", async ({ page }) => {
    await connectKiosk(page);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/\+234|0803|Chioma|David/);
  });
});

test.describe("kiosk: staff check-in security", () => {
  test("a staff card asks for the PIN; a wrong PIN is refused, the right one checks in", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "changes the school's settings once per run");
    const f = fixture();
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const uid = `5C${Date.now().toString(16).toUpperCase().slice(-8)}`;
    const salt = randomBytes(16);
    const { data: staff } = await db.from("staff").insert({ school_id: f.schoolId, name: "Grace Okon" }).select("id").single();
    await db.from("cards").insert({ school_id: f.schoolId, uid, holder_type: "staff", holder_id: staff!.id });
    await db.from("staff_pins").insert({ staff_id: staff!.id, school_id: f.schoolId, pin_hash: `scrypt$${salt.toString("hex")}$${scryptSync("4829", salt, 32).toString("hex")}` });
    await db.from("schools").update({ staff_pin_required: true }).eq("id", f.schoolId);
    try {
      await connectKiosk(page);
      await usbTap(page, uid);
      const dialog = () => page.getByRole("dialog", { name: "Staff check-in" });
      await expect(dialog()).toContainText("Grace");
      await expect(dialog()).toContainText("Enter your 4-digit PIN");
      for (const d of "1111") await dialog().getByRole("button", { name: d, exact: true }).click();
      await dialog().getByRole("button", { name: "Check in" }).click();
      await expect(dialog()).toContainText("Wrong PIN. 4 tries left.");
      for (const d of "4829") await dialog().getByRole("button", { name: d, exact: true }).click();
      await dialog().getByRole("button", { name: "Check in" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Grace Okon" })).toContainText(/Signed in/);
    } finally {
      await db.from("schools").update({ staff_pin_required: false }).eq("id", f.schoolId);
    }
  });
});
