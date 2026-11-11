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
    await page.getByLabel("Password", { exact: true }).fill(f.adminPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/today/);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  });

  test("the privacy notice is public and linked from sign-in", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
    await expect(page.getByText(/deleted automatically/)).toBeVisible();
  });

  test("parents: the portal asks for a phone number, and checks it", async ({ page }) => {
    await page.goto("/parent");
    await expect(page).toHaveURL(/\/parent\/login/);
    await expect(page.getByRole("heading", { name: /Parents: see your child/ })).toBeVisible();
    await page.getByLabel("Your mobile number").fill("12345");
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByText(/Enter your mobile number/)).toBeVisible();
  });

  test("the eye button shows and hides the password", async ({ page }) => {
    await page.goto("/login");
    const box = page.getByLabel("Password", { exact: true });
    await box.fill("Secret-pass1");
    await expect(box).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(box).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(box).toHaveAttribute("type", "password");
  });

  test("an old or broken reset link explains itself instead of failing", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=not-a-real-token&type=recovery");
    await expect(page).toHaveURL(/\/login\?reason=link/);
    await expect(page.getByText(/That link has expired or was already used/)).toBeVisible();
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

test.describe("super admin billing", () => {
  test("set pricing, issue an invoice, open it and mark it paid", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "one super admin login per run");
    test.setTimeout(150_000); // signs in and walks five pages
    const f = fixture();
    await page.goto("/login");
    await page.getByLabel("Email").fill(f.superEmail);
    await page.getByLabel("Password", { exact: true }).fill(f.adminPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/platform/);
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: f.schoolName });
    await row.getByRole("button", { name: /Pricing/ }).click();
    await page.getByLabel("Per student / month").fill("500");
    await page.getByLabel("Setup fee (once)").fill("0");
    await page.getByLabel("Billing starts").fill("2026-01-01");
    await page.getByRole("button", { name: "Save pricing" }).click();
    await expect(page.getByText("Pricing saved.")).toBeVisible();

    const month = new Date().toISOString().slice(0, 7);
    await page.getByLabel("Month", { exact: true }).fill(month);
    await page.locator("#invoice-school").selectOption({ label: f.schoolName }); // never invoice real schools from a test
    await page.getByRole("button", { name: "Issue invoices" }).click();
    await expect(page.getByText(/invoices? issued for/)).toBeVisible();

    // 5 active students x ₦500
    const inv = page.getByRole("row").filter({ hasText: f.schoolName }).filter({ hasText: "₦2,500.00" }).filter({ hasText: "Unpaid" });
    await expect(inv).toBeVisible();
    await inv.getByRole("link").click();
    await expect(page.getByRole("heading", { name: "Invoice" })).toBeVisible();
    await expect(page.getByText("₦2,500.00").filter({ visible: true }).last()).toBeVisible(); // the previous page stays mounted, hidden
    await page.goto("/platform/billing");
    await page.getByRole("row").filter({ hasText: f.schoolName }).filter({ hasText: "₦2,500.00" }).filter({ hasText: "Unpaid" }).getByRole("button", { name: "Mark paid" }).click();
    await expect(page.getByText(/marked paid/)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: f.schoolName }).filter({ hasText: "Paid" })).toBeVisible();
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

  test("getting started: the checklist ticks off what the school has already done", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByRole("heading", { level: 1, name: "Getting started" })).toBeVisible();
    const step = (name: string) => page.getByRole("listitem").filter({ hasText: name });
    await expect(step("Create your classes")).toContainText("(done)");
    await expect(step("Import students and parents")).toContainText("(done)");
    await expect(step("Register the gate kiosk")).toContainText("(done)");
    await expect(step("Enrol ID cards")).toContainText(/\d+ of 5/); // the test school has 5 pupils
    await step("Send yourself a test alert").getByRole("link", { name: "Try it" }).click();
    await expect(page).toHaveURL(/\/alerts#try-it/);
  });

  test("staff are sent back to the dashboard from the parent portal", async ({ page }) => {
    await page.goto("/parent");
    await expect(page).toHaveURL(/\/today/);
  });

  test("help: kiosk lockdown and launch guides are reachable from the sidebar", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { level: 1, name: "Help" })).toBeVisible();
    await page.getByRole("link", { name: "Pilot launch checklist" }).click();
    await expect(page.getByRole("heading", { name: "Pilot launch checklist" })).toBeInViewport();
    await expect(page.getByText(/App pinning/)).toBeVisible();
  });

  test("consent: a photo can only be added after parental consent is recorded", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "writes data once per run");
    const f = fixture();
    const student = f.students[3]!;
    await page.goto(`/students?student=${student.id}`);
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Record parental consent above to add a photo.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Take photo" })).toHaveCount(0);
    await drawer.getByLabel("How").fill("Signed form from mother");
    await drawer.getByRole("button", { name: "Record consent" }).click();
    await expect(page.getByText("Consent recorded. You can now add a photo.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Take photo" })).toBeVisible();
  });

  test("account: two-factor setup shows a QR code and can be cancelled", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "creates an unverified factor once per run");
    await page.goto("/account");
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await page.getByRole("button", { name: "Turn on two-factor login" }).click();
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    await page.getByLabel("Code from the app").fill("000000");
    await page.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(page.getByText(/didn't work/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Turn on two-factor login" })).toBeVisible();
  });

  test("ID cards: one card per student at bank-card size, ready to print", async ({ page }, info) => {
    const f = fixture();
    await page.goto(`/cards/print?class=${f.classId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Print ID cards" })).toBeVisible();
    for (const s of f.students) await expect(page.getByText(s.name, { exact: true })).toBeVisible();
    await expect(page.getByText(/have no photo yet/)).toBeVisible();
    if (info.project.name === "laptop") {
      await page.emulateMedia({ media: "print" });
      await page.screenshot({ path: "test-results/id-cards-print.png", fullPage: true });
    }
  });

  test("activity log lists what happened, in plain English", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByRole("heading", { level: 1, name: "Activity log" })).toBeVisible();
    await page.getByRole("link", { name: "Logins and security" }).click();
    await expect(page.getByRole("link", { name: "Logins and security" })).toHaveAttribute("aria-current", "page");
  });

  test("appearance: dark mode is remembered, and Auto follows the device", async ({ page }, info) => {
    await page.goto("/today");
    const html = page.locator("html");
    const menu = async () => { if (info.project.name === "phone") await page.getByRole("button", { name: "Open menu" }).click(); };
    await menu();
    await page.getByRole("radio", { name: "Dark" }).first().click();
    await expect(html).toHaveClass(/dark/);
    await page.reload();
    await expect(html).toHaveClass(/dark/); // applied before paint, no flash
    await menu();
    if (info.project.name === "laptop") await page.screenshot({ path: "test-results/today-dark.png", fullPage: true });
    await page.getByRole("radio", { name: "Light" }).first().click();
    await expect(html).not.toHaveClass(/dark/);
    if (info.project.name === "laptop") await page.screenshot({ path: "test-results/today-light.png", fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("radio", { name: "Auto" }).first().click();
    await expect(html).toHaveClass(/dark/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).not.toHaveClass(/dark/);
  });

  test("alerts: gate sounds play and a test alert previews the real wording", async ({ page }, info) => {
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "Test sounds and alerts" })).toBeVisible();
    await page.getByRole("button", { name: "Play Sign in" }).click();
    await page.getByLabel("Alert type").selectOption("absence");
    await expect(page.getByText(/^TEST: /)).toBeVisible();
    await page.getByLabel("Send to").fill("12345");
    await page.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByText("Enter a Nigerian mobile number, like 0803 123 4567.")).toBeVisible();
    if (info.project.name === "laptop") {
      await page.getByRole("heading", { name: "Test sounds and alerts" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: "test-results/alerts-test-panel.png" });
    }
  });

  test("reports: staff tab with an Excel download", async ({ page }) => {
    await page.goto("/reports?who=staff");
    await expect(page.getByRole("link", { name: "staff", exact: true })).toHaveAttribute("aria-current", "page");
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Excel" }).click();
    expect((await download).suggestedFilename()).toMatch(/^tapin-staff-/);
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
