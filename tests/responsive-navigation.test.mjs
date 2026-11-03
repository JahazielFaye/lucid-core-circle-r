import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

test('resizing an open mobile drawer to desktop clears the drawer state and scroll lock', () => {
  assert.match(page, /const mobileQuery = window\.matchMedia\('\(max-width: 820px\)'\)/);
  assert.match(page, /if \(mobileQuery\.matches\) return;/);
  assert.match(page, /setMobileNavOpen\(false\);/);
  assert.match(page, /mobileQuery\.addEventListener\('change', closeDrawerOutsideMobile\)/);
  assert.match(page, /body\.style\.position = 'fixed';/);
  assert.match(page, /root\.style\.overflow = 'hidden';/);
  assert.match(page, /window\.scrollTo\(0, scrollY\);/);
  assert.match(page, /window\.cancelAnimationFrame\(mobileDrawerRestoreFrame\.current\)/);
});

test('every mobile drawer dismissal returns focus to the menu trigger on a mobile viewport', () => {
  assert.match(page, /const focusTarget = window\.matchMedia\('\(max-width: 820px\)'\)\.matches\s*\? mobileNavigationTrigger\.current\s*:\s*brandButton\.current/);
  assert.match(page, /onPointerDown=\{event => \{ if \(event\.target === event\.currentTarget\) \{ event\.preventDefault\(\); closeMobileNavigation\(\); \} \}\}/);
  assert.match(page, /focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(page, /if \(event\.key === 'Escape'\) \{ closeMobileNavigation\(\); return; \}/);
});

test('mobile drawer prevents background gestures while preserving its own internal scrolling', () => {
  assert.match(page, /document\.addEventListener\('touchmove', preventBackgroundScroll, \{ passive: false \}\)/);
  assert.match(page, /document\.addEventListener\('wheel', preventBackgroundScroll, \{ passive: false \}\)/);
  assert.match(page, /if \(!mobileDrawer\.current\?\.contains\(event\.target as Node\)\) event\.preventDefault\(\);/);
  assert.match(page, /document\.removeEventListener\('touchmove', preventBackgroundScroll\)/);
  assert.match(styles, /\.mobile-drawer-backdrop\{touch-action:none;overscroll-behavior:contain\}/);
  assert.match(styles, /\.mobile-drawer\{touch-action:pan-y;overscroll-behavior:contain\}/);
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
