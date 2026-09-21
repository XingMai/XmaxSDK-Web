const assert = require('node:assert/strict');
const { XmaxClient, RealtimeContext } = require('@xmaxai/web-sdk');
const { XmaxVideo, XmaxRealtimeVideo } = require('@xmaxai/web-sdk/react');
assert.equal(new RealtimeContext({ prompt: 'CJS' }).prompt, 'CJS');
for (const symbol of [XmaxClient, XmaxVideo, XmaxRealtimeVideo]) assert.equal(typeof symbol, 'function');
console.log('CommonJS package imports passed');
