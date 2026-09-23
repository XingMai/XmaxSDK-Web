import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatisticsPanel } from "../src/StatisticsPanel";

it("preserves the definition-list structure, metric order, zero values and placeholders", () => {
  const html = renderToStaticMarkup(<StatisticsPanel label="下行视频统计" rows={[
    { label: "下行分辨率", value: "—" },
    { label: "下行帧率", value: "0 fps" },
    { label: "下行码率", value: "6006.5 kbps" },
  ]} />);

  expect(html).toBe('<dl class="videoStatistics" aria-label="下行视频统计">'
    + '<div><dt>下行分辨率</dt><dd>—</dd></div>'
    + '<div><dt>下行帧率</dt><dd>0 fps</dd></div>'
    + '<div><dt>下行码率</dt><dd>6006.5 kbps</dd></div></dl>');
});

it("preserves launch-panel styling, row tooltips and total highlighting", () => {
  const html = renderToStaticMarkup(<StatisticsPanel className="launchTiming" label="启动耗时统计" rows={[
    { label: "亮度检测", value: "20 ms", title: "与建立连接并行，未计入连接耗时" },
    { label: "完整启动耗时", value: "1500 ms", className: "launchTimingTotal" },
  ]} />);

  expect(html).toBe('<dl class="launchTiming" aria-label="启动耗时统计">'
    + '<div title="与建立连接并行，未计入连接耗时"><dt>亮度检测</dt><dd>20 ms</dd></div>'
    + '<div class="launchTimingTotal"><dt>完整启动耗时</dt><dd>1500 ms</dd></div></dl>');
});
