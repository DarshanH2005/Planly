import { test, expect } from "@playwright/test";

test.describe("Sprint 01 Authentication & Allowlist Flow", () => {
  test("renders login page with single-owner security messaging and form fields", async ({
    page,
  }) => {
    await page.goto("/login");

    // Brand and security badge visibility
    await expect(page.locator("text=Authorized owner access")).toBeVisible();
    await expect(page.locator("text=Single-owner private installation")).toBeVisible();

    // Required form inputs
    const emailInput = page.locator("#email");
    const passwordInput = page.locator("#password");
    const submitButton = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute("type", "email");
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute("type", "password");
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toContainText("Access workbench");
  });

  test("displays error notice when an unallowlisted user attempts to log in", async ({
    page,
  }) => {
    // Intercept login route to return 403 Forbidden for non-allowlisted account
    await page.route("**/api/auth/login", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          message: "This account is not authorized for the private workbench.",
        }),
      });
    });

    await page.goto("/login");

    await page.fill("#email", "intruder@example.com");
    await page.fill("#password", "WrongPassword123!");
    await page.click('button[type="submit"]');

    // Verify alert message rendered
    const alert = page.locator('[data-testid="auth-alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("This account is not authorized for the private workbench.");
  });

  test("displays invalid credentials notice on bad credentials", async ({
    page,
  }) => {
    // Intercept login route to return 401 Unauthorized
    await page.route("**/api/auth/login", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          message: "Invalid credentials.",
        }),
      });
    });

    await page.goto("/login");

    await page.fill("#email", "owner@planly.internal");
    await page.fill("#password", "wrongpass");
    await page.click('button[type="submit"]');

    const alert = page.locator('[data-testid="auth-alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Invalid credentials.");
  });
});
