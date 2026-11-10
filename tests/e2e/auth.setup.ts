import { expect, test as setup } from "@playwright/test";
import { ADMIN_STATE, fixture } from "./fixture-data";

/** Signs the test school admin in once; other tests reuse the session (login is rate limited). */
setup("sign in as school admin", async ({ page }) => {
  const f = fixture();
  await page.goto("/login");
  await page.getByLabel("Email").fill(f.adminEmail);
  await page.getByLabel("Password").fill(f.adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today/);
  await page.context().storageState({ path: ADMIN_STATE });
});
