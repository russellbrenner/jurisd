import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Auto-clear mock call history between tests. Matches Vitest <=3.x default
    // behaviour; Vitest 4.x stopped doing this for vi.mock()-created module
    // mocks, which caused cross-test call-history leaks across module mocks
    // reading a stale call from an earlier test via mock.calls[0].
    clearMocks: true,
    // Don't pick up emitted build output or any nested node_modules (including
    // those under sibling git worktrees). Recursive globs are required:
    // bare "node_modules" does not match nested paths and lets vitest crawl
    // dependency test suites under .worktrees/*/node_modules.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.worktrees/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "dist/",
        "src/test/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "src/index.ts",
        "src/server.ts",
        "vitest.config.ts",
      ],
      all: true,
      lines: 95,
      functions: 95,
      branches: 90,
      statements: 95,
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
