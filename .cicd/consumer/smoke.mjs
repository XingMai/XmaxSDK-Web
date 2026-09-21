import assert from 'node:assert/strict';
import { RealtimeConfiguration, RealtimeModel, RealtimeContext, XmaxClient } from '@xmaxai/web-sdk';
import { XmaxVideo, XmaxRealtimeVideo } from '@xmaxai/web-sdk/react';
assert.equal(new RealtimeConfiguration({ model: RealtimeModel.x2_fast_1080p, frameInterpolation: { enabled: true } }).frameInterpolation.enabled, true);
assert.equal(new RealtimeContext({ prompt: ' package test ' }).prompt, 'package test');
for (const symbol of [XmaxClient, XmaxVideo, XmaxRealtimeVideo]) assert.equal(typeof symbol, 'function');
console.log('ESM package imports passed');
