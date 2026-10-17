import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatisticsPanel } from "../src/StatisticsPanel";

it("preserves the definition-list structure, metric order, zero values and placeholders", () => {
  const html = renderToStaticMarkup(<StatisticsPanel label="下行视频统计" rows={[
    { label: "下行分辨率", value: "—" },
    { label: "下行帧率", value: "0 fps" },
    { label: "渲染帧率", value: "49.8 fps" },
    { label: "下行码率", value: "6006.5 kbps" },
  ]} />);

  expect(html).toBe('<dl class="videoStatistics" aria-label="下行视频统计">'
    + '<div><dt>下行分辨率</dt><dd>—</dd></div>'
    + '<div><dt>下行帧率</dt><dd>0 fps</dd></div>'
    + '<div><dt>渲染帧率</dt><dd>49.8 fps</dd></div>'
    + '<div><dt>下行码率</dt><dd>6006.5 kbps</dd></div></dl>');
});

it("preserves launch-panel styling, row tooltips and total highlighting", () => {
  const html = renderToStaticMarkup(<StatisticsPanel className="launchTiming" label="启动耗时统计" rows={[
    { label: "RTC 进房", value: "200 ms", title: "仅统计 RTC 进房调用耗时" },
    { label: "渲染预热", value: "1000 ms", title: "首帧后预热，不含渐入动画" },
    { label: "完整启动耗时", value: "1500 ms", className: "launchTimingTotal" },
  ]} />);

  expect(html).toBe('<dl class="launchTiming" aria-label="启动耗时统计">'
    + '<div title="仅统计 RTC 进房调用耗时"><dt>RTC 进房</dt><dd>200 ms</dd></div>'
    + '<div title="首帧后预热，不含渐入动画"><dt>渲染预热</dt><dd>1000 ms</dd></div>'
    + '<div class="launchTimingTotal"><dt>完整启动耗时</dt><dd>1500 ms</dd></div></dl>');
});
