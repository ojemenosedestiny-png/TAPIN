import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_STATE } from "./fixture-data";

test.describe("public home page", () => {
  test("says what TapIn is, and the live greeting follows the name you type", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Every child counted." })).toBeVisible();
    await expect(page.getByText(/NFC attendance for Nigerian schools/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Book a demo" }).first()).toBeVisible();

    const name = page.getByLabel("Try it with your child's name");
    await name.fill("Ngozi Bello");
    await expect(page.getByRole("img", { name: "The gate kiosk greeting Ngozi Bello" })).toBeVisible();
    await expect(page.getByText("Ngozi Bello arrived at school at 7:42 AM.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hear the greeting for Ngozi" })).toBeEnabled();
  });

  test("the school day opens one part at a time", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Absence check" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Absence check" })).toBeVisible();
    await expect(page.getByText(/hasn't tapped in by the cutoff/)).toBeVisible();
  });

  test("the Book a demo slip checks the details and reaches the super admin", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop", "writes one row per run");
    const school = `E2E Demo School ${Date.now()}`;
    await page.goto("/#demo");
    await page.getByRole("button", { name: "Send the slip" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter a Nigerian mobile number, like 0803 123 4567.")).toBeVisible();

    await page.getByLabel("Your name").fill("Mrs Test Adebayo");
    await page.getByLabel("School name").fill(school);
    await page.getByLabel("Phone (WhatsApp)").fill("0803 000 0000");
    await page.getByLabel("How many pupils (optional)").fill("420");
    await page.getByRole("button", { name: "Send the slip" }).click();
    await expect(page.getByText(`Thank you, Mrs Test Adebayo. We'll call you to arrange a visit to ${school}.`)).toBeVisible();

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data } = await db.from("demo_requests").select("name, phone, pupils").eq("school", school).single();
    expect(data).toEqual({ name: "Mrs Test Adebayo", phone: "+2348030000000", pupils: 420 });
    await db.from("demo_requests").delete().eq("school", school);
  });
});

test.describe("signed in", () => {
  test.use({ storageState: ADMIN_STATE });
  test("staff going to the home page land on their dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/today/);
  });
});
