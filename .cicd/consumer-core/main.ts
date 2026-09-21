import { XmaxClient, RealtimeConfiguration, RealtimeModel } from '@xmaxai/web-sdk';

// Bundle public core APIs without React or React type declarations installed.
console.log(XmaxClient, new RealtimeConfiguration({ model: RealtimeModel.x2_fast_1080p }));
