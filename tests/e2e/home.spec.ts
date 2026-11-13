import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_STATE } from "./fixture-data";

const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

test.describe("public website", () => {
  test("home page says what TapIn is, and links to pricing and log in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Every child, accounted for/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /kiosk greeting Chioma Okafor/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "One tap does the whole register." })).toBeVisible();
    await page.getByRole("link", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("Book a free demo opens the request form, which checks the details and reaches the super admin", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "writes one row per run");
    const school = `E2E Demo School ${Date.now()}`;
    await page.goto("/");
    await page.getByRole("button", { name: "Book a free demo" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Book a free demo" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Request my demo" }).click();
    await expect(dialog.getByText("Enter your name.")).toBeVisible();
    await dialog.getByLabel("Your name").fill("Mrs Test Adebayo");
    await dialog.getByLabel("School name").fill(school);
    await dialog.getByLabel("Phone (WhatsApp)").fill("0803 000 0000");
    await dialog.getByRole("button", { name: "Request my demo" }).click();
    await expect(dialog.getByText(`Thank you, Mrs Test Adebayo. We'll call you to arrange a visit to ${school}.`)).toBeVisible({ timeout: 30_000 });
    const db = service();
    await expect.poll(async () => (await db.from("demo_requests").select("id").eq("school", school)).data?.length).toBe(1);
    await db.from("demo_requests").delete().eq("school", school);
  });

  test("pricing: a school chooses a plan and orders; without online payment it gets an invoice", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "writes one row per run");
    const school = `E2E Order School ${Date.now()}`;
    await page.goto("/pricing?plan=starter");
    await expect(page.getByRole("heading", { level: 1, name: "Pricing and payments" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Starter/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: /^Standard/ }).click();
    await page.getByRole("radio", { name: /USSD/ }).click();
    const form = page.locator("#school-order");
    await form.getByLabel("School name").fill(school);
    await form.getByLabel("Number of students").fill("120");
    await form.getByLabel("Your name").fill("Mr Test Okon");
    await form.getByLabel("Phone number").fill("08030000000");
    await form.getByLabel("Email").fill("order-test@example.com");
    await page.getByRole("button", { name: /Request a quote|Get an invoice|Pay securely/ }).click();
    await expect(page.getByRole("heading", { name: "Order received" })).toBeVisible();
    const db = service();
    const { data } = await db.from("orders").select("plan, students, method, status").eq("school_name", school).single();
    expect(data).toMatchObject({ plan: "standard", students: 120, method: "ussd" });
    await db.from("orders").delete().eq("school_name", school);
  });

  test("pricing: parents must match the school code, student ID and their own phone", async ({ page }) => {
    await page.goto("/pricing?for=parents");
    await expect(page.getByRole("tab", { name: "For parents" })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("School code").fill("NOPE-XX");
    await page.getByLabel("Student ID").fill("STU0001");
    await page.getByLabel("Your phone number").fill("08030000000");
    await page.getByRole("button", { name: "Find my child" }).click();
    await expect(page.getByText(/couldn't find a match/)).toBeVisible();
  });
});

test.describe("security", () => {
  test("every page is sent with the security headers", async ({ request }) => {
    for (const path of ["/", "/pricing", "/login", "/kiosk"]) {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["strict-transport-security"], path).toContain("max-age=");
      expect(h["x-powered-by"], path).toBeUndefined();
    }
  });
  test("the theme switch is on the public site on a phone too", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Appearance:/ }).or(page.getByRole("radiogroup", { name: "Appearance" }).first()).first().waitFor();
  });
});

test.describe("signed in", () => {
  test.use({ storageState: ADMIN_STATE });
  test("staff going to the home page land on their dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/today/);
  });
});
