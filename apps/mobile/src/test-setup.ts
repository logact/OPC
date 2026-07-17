// Polyfills required by the `mqtt` package in the test environment.
import { Buffer } from 'buffer';

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
