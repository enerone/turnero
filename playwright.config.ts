import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  webServer: {
    command: 'npm run dev -- -p 3100',
    url: 'http://localhost:3100',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // E2E no necesita pg-boss real: los tests no dependen de jobs y así
      // evitamos ruido de logs cuando el schema pgboss ya existe.
      JOBS_ENABLED: 'false',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
