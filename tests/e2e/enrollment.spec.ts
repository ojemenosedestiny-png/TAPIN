import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE, fixture, freshUid } from "./fixture-data";

// Signed in once by auth.setup.ts (login is rate limited, so tests reuse the session).
test.use({ storageState: ADMIN_STATE });

async function login(page: Page) {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today/);
}

async function typeCard(page: Page, uid: string) {
  await page.getByPlaceholder("04A35B1C").fill(uid);
  await page.getByRole("button", { name: "Use", exact: true }).click();
}

test.describe("enrollment", () => {
  test.describe.configure({ mode: "serial" });

  test("dashboard navigation works on this screen size", async ({ page }) => {
    await login(page);
    for (const [name, heading] of [["Students", "Students"], ["Classes", "Classes"], ["Cards", "Cards"], ["Devices", "Devices"]]) {
      const menu = page.getByRole("button", { name: "Open menu" });
      // Below the lg breakpoint (1024 px) the sidebar is a drawer behind "Open menu".
      if ((page.viewportSize()?.width ?? 1440) < 1024) {
        // The first tap can land before the page is interactive; tap until the drawer opens.
        await expect(async () => {
          await menu.click();
          await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 15_000 });
        await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name, exact: true }).click();
      } else {
        await page.getByRole("link", { name, exact: true }).click();
      }
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });

  test("single enrollment: assign, conflict on reuse, test needs a photo", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "writes data once per run");
    const f = fixture();
    const [chioma, david] = f.students;
    const uid = freshUid("0D");
    await login(page);

    // Assign a card to Chioma
    await page.goto(`/students?student=${chioma!.id}`);
    await expect(page.getByRole("dialog").getByText(chioma!.name).first()).toBeVisible();
    await page.getByRole("button", { name: "Assign card" }).click();
    await expect(page.getByText("Hold the new card near the device")).toBeVisible();
    await typeCard(page, uid);
    await expect(page.getByText("Card linked.")).toBeVisible();
    await expect(page.getByText(`••••${uid.slice(-4)}`)).toBeVisible();

    // Test card without a photo: refused
    await page.getByRole("button", { name: "Test card" }).click();
    await typeCard(page, uid);
    await expect(page.getByText(/Add a photo first/)).toBeVisible();
    await page.keyboard.press("Escape");

    // The same card for David: conflict naming Chioma, needs confirmation
    await page.goto(`/students?student=${david!.id}`);
    await page.getByRole("button", { name: "Assign card" }).click();
    await typeCard(page, uid);
    await expect(page.getByText(`This card belongs to ${chioma!.name} (${f.className}). Reassign?`)).toBeVisible();
    await page.getByRole("button", { name: "Use a different card" }).click();
    await expect(page.getByText("Hold the new card near the device")).toBeVisible();
  });

  test("class enrollment: link, reject a used card, skip, undo, summary", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "writes data once per run");
    const f = fixture();
    await login(page);
    await page.goto(`/enroll/class/${f.classId}`);
    await expect(page.getByRole("heading", { name: `${f.className} — card enrollment` })).toBeVisible();

    // The first student without a card (David, Amaka, Tunde — Chioma got one above, sorted by surname)
    const first = page.getByText("Tap a card for").locator("..").locator("p").nth(1);
    const firstName = await first.innerText();

    // A card that's already in use is rejected and the queue doesn't move
    await typeCard(page, f.kioskStudent.uid);
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)").filter({ hasText: "Card already in use" })).toBeVisible();
    await expect(first).toHaveText(firstName);

    // Link a new card → moves on
    await typeCard(page, freshUid("0E"));
    await expect(page.getByRole("status").filter({ hasText: `Linked to ${firstName}` })).toBeVisible();
    await expect(first).not.toHaveText(firstName);
    const second = await first.innerText();

    // Skip, then Undo the skip
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(first).not.toHaveText(second);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(first).toHaveText(second);

    // Undo the link too
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText(/unlinked/)).toBeVisible();
    await expect(first).toHaveText(firstName);

    // Skip everyone → summary + printable list
    while (await page.getByRole("button", { name: "Skip" }).isVisible()) await page.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("heading", { name: `${f.className} done` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print list" })).toBeVisible();
  });
});
