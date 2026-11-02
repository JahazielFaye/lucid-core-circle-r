import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

test('resizing an open mobile drawer to desktop clears the drawer state and scroll lock', () => {
  assert.match(page, /const mobileQuery = window\.matchMedia\('\(max-width: 820px\)'\)/);
  assert.match(page, /if \(mobileQuery\.matches\) return;/);
  assert.match(page, /setMobileNavOpen\(false\);\s*document\.body\.style\.overflow = '';/);
  assert.match(page, /mobileQuery\.addEventListener\('change', closeDrawerOutsideMobile\)/);
});

test('every mobile drawer dismissal returns focus to the menu trigger on a mobile viewport', () => {
  assert.match(page, /const focusTarget = window\.matchMedia\('\(max-width: 820px\)'\)\.matches\s*\? mobileNavigationTrigger\.current\s*:\s*brandButton\.current/);
  assert.match(page, /event\.target === event\.currentTarget\) closeMobileNavigation\(\)/);
});

test('fresh profiles auto-collapse only at the intended laptop breakpoint while explicit preferences remain supported', () => {
  assert.match(page, /\(min-width: 821px\) and \(max-width: 1180px\)/);
  assert.match(page, /lucid-core-desktop-navigation-mode/);
  assert.match(styles, /@media \(min-width:821px\) and \(max-width:1180px\)\{\.workspace\.nav-auto\{grid-template-columns:76px minmax\(0,1fr\)\}/);
});

test('only Inventory data regions scroll horizontally on narrow viewports', () => {
  assert.match(styles, /html,body\{max-width:100%;overflow-x:clip\}/);
  assert.match(styles, /\.master-table-wrap\{width:100%;max-width:100%;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain/);
  assert.match(styles, /\.app-shell,\.workspace,\.content,\.master-data-workspace,\.master-data-surface\{min-width:0;max-width:100%\}/);
});
