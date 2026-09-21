import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { XmaxClient, RealtimeContext } from '@xmaxai/web-sdk';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@xmaxai/web-sdk'));
for (const name of ['react', 'react-dom', '@types/react/package.json']) {
  assert.throws(() => sdkRequire.resolve(name), { code: 'MODULE_NOT_FOUND' });
}
assert.equal(typeof XmaxClient, 'function');
assert.equal(new RealtimeContext({ prompt: ' core ' }).prompt, 'core');
assert.equal(typeof require('@xmaxai/web-sdk').XmaxClient, 'function');
console.log('Core ESM/CommonJS imports passed without React installed');
