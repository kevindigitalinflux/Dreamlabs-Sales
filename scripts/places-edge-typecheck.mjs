// Local TypeScript shim only. No Deno runtime, provider calls or remote operations.
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = new URL('../.superpowers/places-check/', import.meta.url);
mkdirSync(scratch, { recursive: true });
writeFileSync(new URL('edge.d.ts', scratch), `declare namespace Deno { function serve(handler: (req: Request) => Response | Promise<Response>): void; namespace env { function get(name: string): string | undefined; } }
declare module 'https://deno.land/x/denomailer@1.6.0/mod.ts' { export class SMTPClient { constructor(config: unknown); send(message: unknown): Promise<void>; close(): Promise<void>; } }
`);
const functions = ['org-api-settings', 'scrape-google-places', 'run-deep-find', 'enrich-leads-bulk', 'run-autopilot', 'run-lookup-jobs', 'run-selected-autopilot', 'scrape-companies-house', 'scrape-cro', 'reveal-decision-maker', 'apollo-phone-webhook', 'find-decision-makers', 'check-sequences', 'send-email', 'check-replies', 'email-settings', 'draft-reply'];
writeFileSync(new URL('tsconfig.json', scratch), JSON.stringify({ compilerOptions: {
  target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler',
  strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true,
  paths: { 'npm:@supabase/supabase-js@2': ['../../node_modules/@supabase/supabase-js/dist/index.d.mts'],
    'npm:libphonenumber-js@1.13.15/max': ['../../node_modules/libphonenumber-js/max/index.d.ts'],
    'npm:postal-mime@2.4.3': ['../reply-edge-deps/node_modules/postal-mime/postal-mime.d.ts'],
    'npm:imapflow@1': ['../reply-edge-deps/node_modules/imapflow/lib/imap-flow.d.ts'] },
}, files: ['edge.d.ts', ...functions.map(name => `../../supabase/functions/${name}/index.ts`)] }, null, 2));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '--noEmit', '-p', '.superpowers/places-check/tsconfig.json'], { cwd: root, stdio: 'inherit' });
if (result.error) throw new Error('Could not start local edge TypeScript check.');
process.exitCode = result.status ?? 1;
