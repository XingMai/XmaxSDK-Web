import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatisticsToggle } from "../src/StatisticsToggle";

it.each([true, false])("reflects visibility %s and controls both overlays", (visible) => {
  const html = renderToStaticMarkup(<StatisticsToggle visible={visible} onChange={() => {}} />);
  expect(html).toContain(`aria-pressed="${visible}"`);
  expect(html).toContain('aria-controls="local-statistics remote-statistics"');
  expect(html).toContain(`class="statisticsToggle${visible ? " active" : ""}"`);
});

it.each([true, false])("only requests the opposite display state when clicked from %s", (visible) => {
  const onChange = vi.fn();
  const button = StatisticsToggle({ visible, onChange });
  button.props.onClick();
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith(!visible);
});
