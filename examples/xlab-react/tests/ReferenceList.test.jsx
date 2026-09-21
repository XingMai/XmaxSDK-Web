import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceList } from "../src/ReferenceList";

function render(items) {
  return renderToStaticMarkup(<ReferenceList items={items} rowRef={createRef()} lineCapacity={4}
    disabled={false} onUpload={() => {}} onSelect={() => {}} />);
}

function item(name, status = "ready") {
  return { id: name, name, mode: "charx", thumbnail: `/images/${name}.png`,
    prompt: "prompt", is_selected: false, upload_status: status };
}

it("puts Upload in the first grid cell, followed by uploaded images and then presets", () => {
  const html = render([item("Newest"), item("Earlier"), item("Preset")]);
  expect(html.indexOf('class="presetLine"')).toBeLessThan(html.indexOf("uploadItem"));
  expect(html.indexOf("uploadItem")).toBeLessThan(html.indexOf('alt="Newest"'));
  expect(html.indexOf('alt="Newest"')).toBeLessThan(html.indexOf('alt="Earlier"'));
  expect(html.indexOf('alt="Earlier"')).toBeLessThan(html.indexOf('alt="Preset"'));
  expect(html.match(/uploadItem/g)).toHaveLength(1);
});

it("shows the loading local preview after Upload", () => {
  const html = render([item("Local", "uploading")]);
  expect(html.indexOf(">Upload<")).toBeLessThan(html.indexOf('alt="Local"'));
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("Uploading…");
});

it("keeps Upload available when the reference list is empty", () => {
  const html = render([]);
  expect(html).toContain(">Upload<");
  expect(html.match(/class="presetLine"/g)).toHaveLength(1);
});

it("counts Upload in row capacity and starts the second row with an image, not a blank cell", () => {
  const html = render([item("A"), item("B"), item("C"), item("D"), item("E")]);
  const lines = html.split('<div class="presetLine">').slice(1);
  expect(lines).toHaveLength(2);
  expect(lines[0].match(/<button/g)).toHaveLength(4);
  expect(lines[1]).toMatch(/^<button[^>]*>/);
  expect(lines[1]).toContain('alt="D"');
  expect(lines[1]).not.toContain("uploadItem");
});
