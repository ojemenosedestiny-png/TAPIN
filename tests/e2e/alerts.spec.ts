import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STATE } from "./fixture-data";

test.use({ storageState: ADMIN_STATE });

async function login(page: Page) {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today/);
}

test.describe("alerts and settings", () => {
  test.describe.configure({ mode: "serial" });

  test("alerts page: switches, live template preview, save", async ({ page }) => {
    await login(page);
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
    await expect(page.getByText("SMS this month")).toBeVisible();

    const arrival = page.getByLabel("Message").first();
    await arrival.fill("{greeting}, {first_name} is in school at {time}.");
    await expect(page.getByText("Good morning, Chioma is in school at 7:42 AM.")).toBeVisible();

    await arrival.fill("Hello {parent_name}");
    await expect(page.getByText("Unknown field: {parent_name} — sent as typed.")).toBeVisible();
    await arrival.fill("{greeting}. {full_name} arrived at {school} at {time}.");

    await page.getByRole("button", { name: "Save alert settings" }).click();
    await expect(page.getByText("Alert settings saved.")).toBeVisible();
  });

  test("settings: school day and holidays", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "writes data once per run");
    await login(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "School calendar" })).toBeVisible();

    // Invalid: closing before resumption
    await page.getByLabel("Closing").fill("07:00");
    await page.getByRole("button", { name: "Save school day" }).click();
    await expect(page.getByText("Closing time must be after resumption time.")).toBeVisible();
    await page.getByLabel("Closing").fill("14:00");
    await page.getByRole("button", { name: "Save school day" }).click();
    await expect(page.getByText("School day saved.")).toBeVisible();

    // Add a holiday a month ahead on a weekday
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 30);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    await page.getByLabel("From").fill(d.toISOString().slice(0, 10));
    await page.getByLabel("Note").fill("E2E holiday");
    await page.getByRole("button", { name: "Add holiday" }).click();
    await expect(page.getByText("1 school day marked as holiday.")).toBeVisible();
    await expect(page.getByText("E2E holiday")).toBeVisible();
  });
});
