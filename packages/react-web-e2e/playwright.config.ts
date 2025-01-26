import { defineConfig, devices } from '@playwright/test';

const headed = process.env.HEADED === 'true'; // default is headless unless HEADED=true

export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'line',
  use: {
    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',
    /* Ignore HTTPS certificate errors (for local dev). */
    ignoreHTTPSErrors: true,
  },

  /* Configure projects for major browsers. */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // If you want to see the browser UI for debugging:
        headless: !headed,
        // Grant permission for notifications in the context.
        permissions: ['notifications', 'storage-access'],
        //    Add any Chromium-specific launch options.
        launchOptions: {
          args: [
            '--enable-features=StorageAPI',
            '--disable-web-security',
          ],
        },
      },
    },
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     headless: !headed,
    //     permissions: ['notifications', 'storage-access', 'camera'],
    //     // Firefox user prefs
    //     launchOptions: {
    //       firefoxUserPrefs: {
    //         'permissions.default.desktop-notification': 1,
    //         'permissions.default.camera': 1,
    //         'dom.storage.enabled': true,
    //         'browser.storageManager.enabled': true,
    //       },
    //     },
    //   },
    // },
  ],
});
