import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { 'npm:libphonenumber-js@1.13.15/max': 'libphonenumber-js/max', 'npm:@supabase/supabase-js@2': '@supabase/supabase-js',
    'npm:postal-mime@2.4.3': fileURLToPath(new URL('./.superpowers/reply-edge-deps/node_modules/postal-mime/src/postal-mime.js', import.meta.url)),
    'npm:imapflow@1': fileURLToPath(new URL('./.superpowers/reply-edge-deps/node_modules/imapflow/lib/imap-flow.js', import.meta.url)),
  } },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.js'],
  },
});
