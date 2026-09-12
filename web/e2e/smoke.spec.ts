import { test, expect } from "@playwright/test";

/* Read-only smoke over every screen — catches routing/render/auth regressions without writing
   to the user's real database. Needs TK (a valid bearer token) in the env. */

const TOKEN = process.env.TK || "";
test.skip(!TOKEN, "TK env var (bearer token) required");

test.beforeEach(async ({ page }) => {
  await page.addInitScript((t) => {
    localStorage.setItem("coach_token", t);
    localStorage.setItem("coach_api_base", "");
  }, TOKEN);
});

test("Home renders today's workout, quick-log tiles and nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Start workout|Continue workout|Start an open session/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Weigh in" })).toBeVisible();
  await expect(page.getByRole("navigation").getByText("Progress")).toBeVisible();
});

test("Weigh-in opens as a sheet and closes without saving", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Weigh in" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Workout screen lists today's exercises", async ({ page }) => {
  await page.goto("/workout");
  await expect(page.getByRole("button", { name: /Start workout|Finish workout/ })).toBeVisible();
});

test("Trends shows weight + measurements", async ({ page }) => {
  await page.goto("/trends");
  await expect(page.getByText("Weight trend", { exact: true })).toBeVisible();
  await expect(page.getByText("Body measurements")).toBeVisible();
});

test("Trends shows the adaptive maintenance card (building or estimate, never a target)", async ({ page }) => {
  await page.goto("/trends");
  const card = page.getByTestId("adaptive-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("Maintenance from your own logs")).toBeVisible();
  // the UI must never surface a suggested calorie target (targets come only from onboarding/coach)
  await expect(card).not.toContainText(/target .*\d{3,4} ?kcal/i);
  await page.screenshot({ path: process.env.SHOT || "test-results/trends.png", fullPage: true });
});

test("Fuel shows food search", async ({ page }) => {
  await page.goto("/nutrition");
  await expect(page.getByPlaceholder(/Search foods/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
});

test("Coach shows the chat input", async ({ page }) => {
  await page.goto("/coach");
  await expect(page.getByPlaceholder("Message your coach")).toBeVisible();
});

test("Programs lists the library and opens the per-program editor", async ({ page }) => {
  await page.goto("/programs");
  await expect(page.getByRole("button", { name: "+ Add a program" })).toBeVisible();
  const firstProgram = page.locator('a[href^="/program?id="]').first();
  await expect(firstProgram).toBeVisible();
  await firstProgram.click();
  // per-program editor (the safe one) — loads that program's own exercises
  await expect(page.getByText("Edit program")).toBeVisible();
  await expect(page.getByRole("button", { name: /Save/ })).toBeVisible();
});

test("Setup shows token field + expiry", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Bearer token")).toBeVisible();
  await expect(page.getByText(/Token valid until/)).toBeVisible();
});
