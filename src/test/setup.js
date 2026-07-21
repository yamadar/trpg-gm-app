import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

afterEach(() => {
  cleanup();
});

// Guard the Element polyfill for node environments where DOM globals don't exist
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Polyfill File.text() and Blob.text() for jsdom if not available.
// jsdom (24.1.3+) does not implement Blob.prototype.text() natively,
// so tests calling .text() on File/Blob objects (e.g. src/utils/fileImport.js)
// would throw "TypeError: f.text is not a function" without this polyfill.
if (typeof Blob !== 'undefined' && !Blob.prototype.text) {
  Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}
