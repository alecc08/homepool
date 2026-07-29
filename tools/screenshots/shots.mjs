// Captures the web-app screenshots in docs/screenshots.
//
// Assumes a seeded throwaway stack (npm run up && npm run seed). Everything the
// app remembers between visits — language, theme, which installation is active,
// which measurement input mode was last used — lives in localStorage, so each
// shot sets those directly rather than clicking its way through the UI.

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ACCOUNT } from './demo-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../docs/screenshots');
const BASE = process.env.HOMEPOOL_URL ?? 'http://localhost:8099';

// Matching the bulk of the existing set. @2x because GitHub serves these into
// half-width table cells, where a 1x capture reads as mush.
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SCALE = 2;

/** English, so the screenshots match the README they live in. */
function bootstrap(theme, measureMode = 'manual') {
  return `
    localStorage.setItem('homepool_locale', 'en');
    localStorage.setItem('homepool_theme', ${JSON.stringify(theme)});
    localStorage.setItem('homepool_measure_mode', ${JSON.stringify(measureMode)});
  `;
}

async function shot(page, name, target = page) {
  await page.waitForTimeout(400); // let CSS transitions and chart draws settle
  await target.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png`);
}

/** Opens the app on the dashboard, signing in only if the context doesn't
 * already hold a session — the second page in a context lands straight on the
 * dashboard, with no login form to fill. */
async function signIn(context, theme, measureMode) {
  const page = await context.newPage();
  await page.addInitScript(bootstrap(theme, measureMode));
  await page.goto(BASE);

  const email = page.locator('input[type="email"]').first();
  if (await email.isVisible({ timeout: 5000 }).catch(() => false)) {
    await email.fill(ACCOUNT.email);
    await page.locator('input[type="password"]').first().fill(ACCOUNT.password);
    await page.locator('form').first().locator('button[type="submit"]').click();
  }

  // The page's own <h1>, not the sidebar's nav item — the sidebar is display:none
  // at mobile widths, so a text match there resolves to something invisible.
  await page.locator('.page-header-title').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForLoadState('networkidle');
  return page;
}

/** Hash routing (App.tsx:29) — cheaper and steadier than clicking the nav. */
async function goTo(page, route) {
  await page.evaluate(r => { window.location.hash = r; }, route);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
}

async function openEntryForm(page) {
  await page.getByRole('button', { name: 'New entry' }).first().click();
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(400);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ── Desktop, dark ────────────────────────────────────────────────────────
  const dark = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: SCALE });
  const page = await signIn(dark, 'dark');

  console.log('desktop / dark');
  await shot(page, 'dashboard-dark');

  await goTo(page, 'measurements');
  await shot(page, 'measurements-dark');

  await goTo(page, 'maintenance');
  await shot(page, 'maintenance-dark');

  await goTo(page, 'history');
  await shot(page, 'history-dark');

  await goTo(page, 'recommendations');
  await shot(page, 'recommendations-dark');

  // The simulator lives behind the Recommendations page header button.
  await page.getByRole('button', { name: 'Simulator' }).first().click();
  await page.waitForSelector('[role="dialog"]');
  // Prefilled from the latest reading; running it is what shows the point of it.
  await page.getByRole('button', { name: 'Calculate' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'simulator');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── The entry form, both kinds ───────────────────────────────────────────
  console.log('entry form');
  await goTo(page, '');
  await openEntryForm(page);
  await page.getByRole('button', { name: 'Treatment', exact: true }).click();
  await page.waitForTimeout(300);
  // Fill it in — an empty form shows the fields but not what they're for, and
  // picking a product is also what demonstrates the unit defaulting from it.
  await page.getByLabel('Product').click();
  await page.getByRole('option', { name: 'pH decreaser' }).click();
  await page.getByLabel('Amount').fill('400');
  // Drop focus so the last-typed field isn't wearing a focus ring in the shot.
  await page.evaluate(() => document.activeElement?.blur());
  await page.waitForTimeout(300);
  await shot(page, 'modal-treatment');
  await page.keyboard.press('Escape');

  // The strip picker is a localStorage mode, so it needs its own page load.
  const stripPage = await signIn(dark, 'dark', 'strip');
  await openEntryForm(stripPage);
  await shot(stripPage, 'modal-strip');
  await stripPage.close();

  // ── Installation settings tabs ───────────────────────────────────────────
  console.log('installation settings');
  await goTo(page, '');
  for (const [tab, name] of [
    ['Treatments', 'installation-treatments'],
    ['Water Chemistry Targets', 'installation-water'],
    ['Sharing', 'installation-sharing'],
  ]) {
    await page.getByRole('button', { name: 'Edit installation' }).first().click();
    await page.waitForSelector('[role="dialog"]');
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(700);
    await shot(page, name);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  await page.close();

  // ── Desktop, light ───────────────────────────────────────────────────────
  console.log('desktop / light');
  const light = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: SCALE });
  const lightPage = await signIn(light, 'light');
  await shot(lightPage, 'dashboard-light');
  await lightPage.close();

  // ── Mobile PWA ───────────────────────────────────────────────────────────
  console.log('mobile');
  const mobile = await browser.newContext({
    viewport: MOBILE, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const mobilePage = await signIn(mobile, 'dark');
  await shot(mobilePage, 'mobile-dashboard');
  await mobilePage.close();

  // No shot of the mobile entry sheet on purpose. `.mobile-header` and
  // `.mobile-nav` are fixed at z-index 200 (index.css), while the Radix dialog
  // portal sits at 50 — so on a phone the header paints over the open sheet and
  // its title reads through the header's translucent backdrop. Raising the
  // dialog isn't a one-liner either: [data-radix-popper-content-wrapper] is
  // pinned to 200, so lifting dialogs above the chrome would drop every Select
  // popup behind its own modal. Worth fixing on a device, not from here.

  await browser.close();
  console.log(`\n✓ written to ${OUT}`);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
