import { afterEach } from 'vitest';

// Guard against node environment where DOM APIs don't exist
const hasDOM = typeof window !== 'undefined' && typeof Element !== 'undefined';

if (hasDOM) {
  // Import React testing libraries only in jsdom environment
  try {
    require('@testing-library/jest-dom/vitest');
    const { cleanup } = require('@testing-library/react');
    require('fake-indexeddb/auto');

    afterEach(() => {
      cleanup();
    });
  } catch (e) {
    // Imports failed, skip setup
  }

  // Add scrollIntoView polyfill if needed
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
