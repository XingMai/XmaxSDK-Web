import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QualityDebugControls } from "../src/QualityDebugControls";

it("renders separate uplink and downlink controls with an automatic adjustment notice", () => {
  const html = renderToStaticMarkup(<QualityDebugControls disabled={false} onAdjust={() => {}} />);
  for (const label of ["上行降一档", "上行升一档", "下行降一档", "下行升一档", "自动调档仍开启"]) {
    expect(html).toContain(label);
  }
  expect(html.match(/<button/g)).toHaveLength(4);
});

it.each([false, true])("routes each control to the correct direction with disabled=%s", disabled => {
  const onAdjust = vi.fn();
  const tree = QualityDebugControls({ disabled, onAdjust });
  for (const group of tree.props.children[1]) {
    for (const button of group.props.children) {
      expect(button.props.disabled).toBe(disabled);
      button.props.onClick();
    }
  }
  expect(onAdjust.mock.calls).toEqual(disabled ? [] : [
    ["uplink", "downgrade"], ["uplink", "upgrade"],
    ["downlink", "downgrade"], ["downlink", "upgrade"],
  ]);
});
