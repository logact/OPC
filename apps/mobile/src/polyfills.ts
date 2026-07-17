/**
 * React Native polyfills required by the `mqtt` package over TCP.
 * These modules are normally provided by Node.js but must be shimmed in the RN runtime.
 */
import { Buffer } from 'buffer';
import process from 'process';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Buffer = Buffer;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).process = process;
