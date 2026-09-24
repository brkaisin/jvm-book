import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the built explorer in a real browser (WebGL through
// SwiftShader, so they run on machines without a GPU). Build first:
//   npm run build && npm run e2e
// Set CHROMIUM_PATH to reuse an existing Chromium instead of Playwright's.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: { executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, testIgnore: /mobile/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
  webServer: { command: 'npx vite preview --port 4173 --strictPort --outDir ../docs/explorer', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
});
