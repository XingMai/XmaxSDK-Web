import { createRoot } from 'react-dom/client';
import { XmaxVideo, XmaxRealtimeVideo, type XmaxVideoProps } from '@xmaxai/web-sdk/react';
import { XmaxClient, XmaxConfiguration, RealtimeConfiguration, RealtimeModel } from '@xmaxai/web-sdk';

// Compile public configuration and component types. Never open a camera or make an API request.
const client = new XmaxClient(new XmaxConfiguration({ apiKey: 'consumer-compile-only' }));
const configuration = new RealtimeConfiguration({
  model: RealtimeModel.x2_fast_1080p,
  frameInterpolation: { enabled: true },
});
const props: XmaxVideoProps = { mirrored: true };
void [client, configuration];
createRoot(document.getElementById('root')!).render(<>
  <p>XmaxSDK package consumer compiled.</p>
  <XmaxVideo {...props} />
  <XmaxRealtimeVideo />
</>);
