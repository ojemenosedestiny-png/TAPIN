import { expect, test } from "@playwright/test";
import { ADMIN_STATE, fixture } from "./fixture-data";

test.describe("signing in", () => {
  test("an old activity stamp from a previous session doesn't sign you straight back out", async ({ page, context }, info) => {
    test.skip(info.project.name !== "laptop", "one extra login per run (login is rate limited)");
    const f = fixture();
    const base = new URL(info.project.use.baseURL ?? "http://localhost:3100");
    // As if you signed out with the button two days ago.
    await context.addCookies([{ name: "tapin_last_active", value: String(Date.now() - 2 * 86_400_000), domain: base.hostname, path: "/" }]);
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.adminEmail);
    await page.getByLabel("Password").fill(f.adminPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/today/);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  });

  test("forgot password page validates the email", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  });
});

test.describe("today and reports", () => {
  test.use({ storageState: ADMIN_STATE });

  test("today answers who is in school, with the gate chart, classes and the live feed", async ({ page }) => {
    const f = fixture();
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByText("In school", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The morning gate" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "At the gate" })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(`^${f.className}`) }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: f.className })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today and this week" })).toBeVisible();
    for (const s of f.students) await expect(page.getByText(s.name).first()).toBeVisible();
  });

  test("help: kiosk lockdown and launch guides are reachable from the sidebar", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await page.getByRole("link", { name: "Pilot launch checklist" }).click();
    await expect(page.getByRole("heading", { name: "Pilot launch checklist" })).toBeInViewport();
    await expect(page.getByText(/App pinning/)).toBeVisible();
  });

  test("reports: quick ranges and an Excel download", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await page.getByRole("link", { name: "This month" }).click();
    await expect(page.getByRole("link", { name: "This month" })).toHaveAttribute("aria-current", "page");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Excel" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^tapin-attendance-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
