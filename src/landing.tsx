import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing/Landing';
import './index.css';

/**
 * Entry for `index.html`, the marketing page at the site root. The app itself is
 * `app.html` -> `main.tsx`.
 *
 * Note what is absent: no `WorkoutDataProvider`, no IndexedDB, no CSV. The
 * landing renders from nothing but props, which is why it can be the first paint
 * a visitor gets and why `Landing.test.tsx` can mount it without any setup.
 */
const el = document.getElementById('root');
if (!el) throw new Error('#root not found');
createRoot(el).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
