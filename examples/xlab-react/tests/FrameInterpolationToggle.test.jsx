import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FrameInterpolationToggle } from "../src/FrameInterpolationToggle";

it.each([true, false])("reflects feature enabled=%s, not individual interpolated frames", (enabled) => {
  const html = renderToStaticMarkup(<FrameInterpolationToggle enabled={enabled} onToggle={() => {}} />);
  expect(html).toContain(`aria-pressed="${enabled}"`);
  expect(html).toContain(`class="interpolationPill${enabled ? " active" : ""}"`);
  expect(html).toContain("<span>2x</span>");
  expect(html).toContain(enabled ? "点击关闭" : "点击开启");
});

it.each([{ switching: true }, { disabled: true }])("disables the button during unavailable or pending operations: %j", (props) => {
  const html = renderToStaticMarkup(<FrameInterpolationToggle enabled {...props} onToggle={() => {}} />);
  expect(html).toContain('disabled=""');
  expect(html).toContain(`aria-busy="${!!props.switching}"`);
});

it("delegates toggling to the session handler", () => {
  const onToggle = vi.fn();
  FrameInterpolationToggle({ enabled: true, onToggle }).props.onClick();
  expect(onToggle).toHaveBeenCalledOnce();
});
