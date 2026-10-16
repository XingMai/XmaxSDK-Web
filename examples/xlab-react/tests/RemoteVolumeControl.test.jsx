import { renderToStaticMarkup } from "react-dom/server";
import { RemoteVolumeControl } from "../src/RemoteVolumeControl";

it("shows a collapsed mute button at zero volume", () => {
  const html = renderToStaticMarkup(<RemoteVolumeControl volume={0} onChange={() => {}} />);
  expect(html).toContain('aria-label="Remote volume: Muted"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).not.toContain('role="dialog"');
  expect(html).not.toContain('class="remoteVolumeButton active"');
});

it("shows the current percentage and active speaker state", () => {
  const html = renderToStaticMarkup(<RemoteVolumeControl volume={0.65} onChange={() => {}} />);
  expect(html).toContain('aria-label="Remote volume: 65%"');
  expect(html).toContain('class="remoteVolumeButton active"');
});

it("disables volume control when there is no active session", () => {
  const html = renderToStaticMarkup(<RemoteVolumeControl volume={1} disabled onChange={() => {}} />);
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-label="Remote volume: 100%"');
  expect(html).not.toContain('role="dialog"');
});
