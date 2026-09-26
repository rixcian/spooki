import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep test output clean; log tests capture lines with setLogSink.
  test: { env: { LOG_LEVEL: 'silent' } },
});
