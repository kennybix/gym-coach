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

test("Today renders the plan and nav", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
  await expect(page.getByRole("navigation").getByText("Trends")).toBeVisible();
});

test("Trends shows weight + measurements", async ({ page }) => {
  await page.goto("/trends");
  await expect(page.getByText("Weight trend", { exact: true })).toBeVisible();
  await expect(page.getByText("Body measurements")).toBeVisible();
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
