import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

/** Starts the app. Loaded by main.tsx only when the visitor is on the right address, so the sign-in connection is never created on the old one. */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
