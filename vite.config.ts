import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  resolve: { alias: { 'npm:libphonenumber-js@1.13.15/max': 'libphonenumber-js/max', 'npm:@supabase/supabase-js@2': '@supabase/supabase-js' } },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.js'],
  },
});
