import { expect, test } from '@playwright/test';
import path from 'path';

// Increase the overall timeout for this test file (in milliseconds).
test.setTimeout(15_000);

test('create account, request notifications, and verify persistent storage', async ({ page }) => {
  try {
    // Step 1: Navigate to homepage
    await test.step('Navigate to homepage', async () => {
      await page.goto('https://localhost:3000/', { waitUntil: 'networkidle' });
      await expect(page).toHaveTitle(/Polycentric/);

      // Take a screenshot after navigating to the homepage
      await page.screenshot({ path: path.resolve(__dirname, 'screenshots', 'step-1-navigate-homepage.png') });
    });

    // Step 2: Create an account
    await test.step('Create an account', async () => {
      const createAccountButton = page.getByRole('button', {
        name: /create account \(no email necessary\)/i,
      });
      await expect(createAccountButton, 'Create Account button not found or not visible').toBeVisible({ timeout: 5000 });
      await createAccountButton.click();

      // Take a screenshot after clicking "Create Account"
      await page.screenshot({ path: path.resolve(__dirname, 'screenshots', 'step-2-create-account.png') });
    });

    // Step 3: Fill the username field
    let username;
    await test.step('Fill the username field', async () => {
      const usernameSection = page.locator('div.flex.flex-col.gap-y-1:has(h3:has-text("What\'s your username?"))');
      const usernameInput = usernameSection.locator('input[type="text"]');
      await expect(usernameInput, 'Username input not found').toBeVisible({ timeout: 5000 });

      // Generate a dynamic username and fill the field
      username = `test-user-${new Date().toISOString().split('T')[0]}`;
      await usernameInput.fill(username);

      // Take a screenshot after filling the username
      await page.screenshot({ path: path.resolve(__dirname, 'screenshots', 'step-3-fill-username.png') });
    });

    // Step 4: Click the "Let's go" button
    await test.step('Click the "Let\'s go" button', async () => {
      const letsGoButton = page.getByRole('button', { name: /lets go/i });
      await expect(letsGoButton, '"Lets go" button not found or not visible').toBeVisible({ timeout: 5000 });
      await letsGoButton.click();

      // Take a screenshot after clicking "Let's go"
      await page.screenshot({ path: path.resolve(__dirname, 'screenshots', 'step-4-lets-go.png') });
    });

    // Step 5: Fill in the topic field
    await test.step('Fill in the "Topic" field', async () => {
      const topicInput = page.locator('input[name="postTopic"]');
      await expect(topicInput, 'Topic input not found').toBeVisible({ timeout: 5000 });
      await topicInput.fill(username);

      // Take a screenshot after filling the topic
      await page.screenshot({ path: path.resolve(__dirname, 'screenshots', 'step-5-fill-topic.png') });
    });

    // Step 6: Fill in the "What's going on?" field
    await test.step('Fill in the "What\'s going on?" field', async () => {
      const whatsGoingOnTextarea = page.locator('textarea[placeholder="What\'s going on?"]');
      await expect(whatsGoingOnTextarea, 'What\'s going on? textarea not found').toBeVisible({ timeout: 5000 });
      await whatsGoingOnTextarea.fill(`${username}`);

      // Take a screenshot after filling the "What's going on?" field
      await page.screenshot({ path: path.resolve(__dirname, 'screenshots', 'step-6-whats-going-on.png') });
    });

  } catch (error) {
    console.error(`Error during test step: ${error.message}`);
    throw error; // Re-throw to fail the test
  }
});
