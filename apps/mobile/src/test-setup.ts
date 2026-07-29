// Polyfills required by the `mqtt` package in the test environment.
import { Buffer } from 'buffer';

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

// React Native source reads __DEV__ at module scope; Metro normally defines it.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
