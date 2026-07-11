import '@testing-library/jest-dom';

// Ant Design's Row/Col uses useBreakpoint which calls window.matchMedia.
// jsdom does not implement it, so we provide a stub.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
