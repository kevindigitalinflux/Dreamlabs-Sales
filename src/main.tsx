import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './index.css';
import { canonicalRedirect } from './lib/canonicalRedirect';

// The old workers.dev address moves to the main address before anything else starts, so no sign-in or session is
// ever created there. The app itself is loaded only when no redirect is needed.
const target = canonicalRedirect(window.location.href);
if (target) {
  window.location.replace(target);
} else {
  void import('./bootstrap');
}
