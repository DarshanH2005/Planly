import { test, expect } from "@playwright/test";

test.describe("Sprint 06 Application Shell, Layout & Navigation", () => {
  test.describe("Desktop Navigation & Shell (AC-01, AC-02)", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("renders header brand, desktop primary navigation, and navigates routes without 404s", async ({
      page,
    }) => {
      test.setTimeout(90000);
      // 1. Visit today cockpit
      await page.goto("/today");

      // Verify header branding
      await expect(page.locator("header")).toBeVisible();
      await expect(page.getByRole("link", { name: /Planly/i })).toBeVisible();

      // Verify desktop primary navigation landmark
      const desktopNav = page.locator('nav[aria-label="Primary"]');
      await expect(desktopNav).toBeVisible();

      // Mobile nav should be hidden on desktop
      const mobileNav = page.locator('nav[aria-label="Primary mobile"]');
      await expect(mobileNav).toBeHidden();

      // Verify key workspace routes exist and render without 404
      const routesToVerify = [
        { name: "Sprints", path: "/sprints" },
        { name: "Prep", path: "/prep" },
        { name: "Repairs", path: "/repairs" },
        { name: "Evidence", path: "/evidence" },
        { name: "Targets", path: "/targets" },
        { name: "Projects", path: "/projects" },
        { name: "Weekly", path: "/weekly" },
        { name: "Settings", path: "/settings" },
      ];

      for (const route of routesToVerify) {
        const link = desktopNav.getByRole("link", { name: route.name });
        await expect(link).toBeVisible();
        await link.click();
        await expect(page).toHaveURL(new RegExp(route.path));
        // Verify page content loaded without 404 / application crash
        await expect(page.locator("body")).not.toContainText("404");
        await expect(page.locator("body")).not.toContainText("This page could not be found");
      }
    });

    test("navigates to dynamic prep problem route and onboarding page without 404s", async ({
      page,
    }) => {
      test.setTimeout(60000);
      // Test dynamic route /prep/[problemId]
      await page.goto("/prep/P-001");
      await expect(page).toHaveURL("/prep/P-001");
      await expect(page.locator("body")).not.toContainText("404");
      await expect(page.getByText("P-001")).toBeVisible();

      // Test onboarding route
      await page.goto("/onboarding");
      await expect(page).toHaveURL("/onboarding");
      await expect(page.locator("body")).not.toContainText("404");
      await expect(page.getByText("Welcome to Planly")).toBeVisible();
    });
  });

  test.describe("Mobile Navigation (AC-02)", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("collapses desktop nav and renders responsive mobile horizontal navigation", async ({
      page,
    }) => {
      test.setTimeout(60000);
      await page.goto("/today");

      // Desktop navigation should be hidden on mobile screen
      const desktopNav = page.locator('nav[aria-label="Primary"]');
      await expect(desktopNav).toBeHidden();

      // Mobile horizontal navigation should be visible
      const mobileNav = page.locator('nav[aria-label="Primary mobile"]');
      await expect(mobileNav).toBeVisible();

      // Check mobile navigation links (Rooms and Prep)
      const roomsLink = mobileNav.getByRole("link", { name: "Rooms" });
      await expect(roomsLink).toBeVisible();
      await roomsLink.click();
      await expect(page).toHaveURL("/classrooms");

      const prepLink = mobileNav.getByRole("link", { name: "Prep" });
      await expect(prepLink).toBeVisible();
      await prepLink.click();
      await expect(page).toHaveURL("/prep");
    });
  });

  test.describe("Theme Toggle (AC-03)", () => {
    test("switches between light and dark modes and persists in local storage", async ({
      page,
    }) => {
      await page.goto("/today");

      const themeToggle = page.locator('button[aria-label="Toggle theme"]');
      await expect(themeToggle).toBeVisible();

      // Determine initial state
      const initialDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark")
      );

      // Click toggle to flip theme
      await themeToggle.click();

      // Verify html element class toggled
      const toggledDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark")
      );
      expect(toggledDark).toBe(!initialDark);

      // Verify localStorage persistence
      const storedTheme = await page.evaluate(() =>
        localStorage.getItem("planly-theme")
      );
      expect(storedTheme).toBe(toggledDark ? "dark" : "light");

      // Click again to return to original
      await themeToggle.click();
      const restoredDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark")
      );
      expect(restoredDark).toBe(initialDark);
    });
  });

  test.describe("Redirect Logic & Auth Guards (AC-04)", () => {
    test("root route (/) resolves to /today for authenticated owner", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/today$/);
    });

    test("login route is directly accessible with security badges", async ({
      page,
    }) => {
      await page.goto("/login");
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.locator("text=Authorized owner access")).toBeVisible();
    });
  });
});
