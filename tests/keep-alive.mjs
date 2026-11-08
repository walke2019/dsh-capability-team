// Production timers are unref()'d (and AbortSignal.timeout() never holds the loop) so they never hold the DSH process open. On Node 22 the test runner then sees an
// empty event loop while a test still awaits such a timer and cancels it ("Promise resolution is still pending but the
// event loop has already resolved"). Importing this module keeps one ref'd handle alive for the test file's lifetime.
import { before, after } from 'node:test';

let handle;
before(() => { handle = setInterval(() => {}, 1 << 30); });
after(() => clearInterval(handle));
