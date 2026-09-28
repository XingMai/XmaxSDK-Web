import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceList } from "../src/ReferenceList";

function render(items) {
  return renderToStaticMarkup(<ReferenceList items={items} rowRef={createRef()}
    disabled={false} onUpload={() => {}} onSelect={() => {}} />);
}

function item(name, status = "ready") {
  return { id: name, name, mode: "charx", thumbnail: `/images/${name}.png`,
    prompt: "prompt", is_selected: false, upload_status: status };
}

it("puts Upload in the first grid cell, followed by uploaded images and then presets", () => {
  const html = render([item("Newest"), item("Earlier"), item("Preset")]);
  expect(html.indexOf("uploadItem")).toBeLessThan(html.indexOf('alt="Newest"'));
  expect(html.indexOf('alt="Newest"')).toBeLessThan(html.indexOf('alt="Earlier"'));
  expect(html.indexOf('alt="Earlier"')).toBeLessThan(html.indexOf('alt="Preset"'));
  expect(html.match(/uploadItem/g)).toHaveLength(1);
});

it("shows the uploading overlay with a spinner after Upload", () => {
  const html = render([item("Local", "uploading")]);
  expect(html.indexOf(">Upload<")).toBeLessThan(html.indexOf('alt="Local"'));
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("presetSpinner");
});

it("shows the upload progress percentage when available", () => {
  const uploading = { ...item("Local", "uploading"), upload_progress: 42 };
  const html = render([uploading]);
  expect(html).toContain("42%");
});

it("keeps Upload available when the reference list is empty", () => {
  const html = render([]);
  expect(html).toContain(">Upload<");
  expect(html.match(/<button/g)).toHaveLength(1);
});

it("renders all items in a single wrapping row container", () => {
  const html = render([item("A"), item("B"), item("C"), item("D"), item("E")]);
  // CSS flex-wrap 负责换行，标记保持一层面板容器加全部条目。
  expect(html.match(/class="presetRow"/g)).toHaveLength(1);
  expect(html.match(/<button/g)).toHaveLength(6);
  expect(html).toContain('alt="E"');
});
