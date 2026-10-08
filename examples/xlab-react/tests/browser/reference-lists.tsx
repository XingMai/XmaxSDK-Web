import { createRef, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ReferenceList } from "../../src/ReferenceList";
import type { ReferenceItem } from "../../src/ReferenceLibrary";
import "../../src/styles.css";

// Run with the example Vite server at /tests/browser/reference-lists.html.
// Isolated real-browser checks: no camera, API key, upload, or generation calls.
const modes = ["charx", "clothx", "vibex"] as const;
const layout = new URLSearchParams(location.search).get("layout");
const thumbnail = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e5e7eb"/></svg>',
);

function Checks() {
  const [active, setActive] = useState<string>("charx");
  const [result, setResult] = useState("RUNNING");
  const [rows] = useState(() => Object.fromEntries(modes.map(mode => [mode, createRef<HTMLDivElement>()])));
  const [items, setItems] = useState<ReferenceItem[]>(() => modes.flatMap(mode =>
    Array.from({ length: 36 }, (_, index) => ({
      id: `${mode}-${index}`, mode, name: `${mode} ${index}`, thumbnail,
      prompt: "", is_selected: index === 0, upload_status: "ready" as const,
    })),
  ));

  useEffect(() => {
    let cancelled = false;
    const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
    void (async () => {
      await nextFrame();
      if (cancelled) return;
      const axis = layout === "mobile" ? "scrollLeft" : "scrollTop";
      const nodes = modes.map(mode => rows[mode]!.current!);
      const positions = [130, 70, 110];
      const show = async (mode: string) => {
        flushSync(() => setActive(mode));
        await nextFrame();
        for (const [index, node] of nodes.entries()) {
          assert(rows[modes[index]!]!.current === node && node.isConnected, "Category node was replaced");
          assert((getComputedStyle(node).display !== "none") === (modes[index] === mode), "Hidden category still occupies layout");
        }
      };
      assert(matchMedia("(max-width: 720px)").matches === (layout === "mobile"), "Unexpected viewport");
      for (const [index, mode] of modes.entries()) {
        await show(mode);
        nodes[index]![axis] = positions[index]!;
        assert(nodes[index]![axis] === positions[index], "List did not overflow on expected axis");
      }
      await show("free");
      for (const [index, mode] of modes.entries()) {
        await show(mode);
        assert(nodes[index]![axis] === positions[index], "Category lost its scroll position");
      }
      // A new upload resets only the active category; other lists remain untouched.
      await show("clothx");
      flushSync(() => setItems(current => [{ ...current.find(item => item.mode === "clothx")!, id: "new-upload", name: "New upload" }, ...current]));
      nodes[1]!.scrollLeft = 0;
      nodes[1]!.scrollTop = 0;
      positions[1] = 0;
      for (const [index, mode] of modes.entries()) {
        await show(mode);
        assert(nodes[index]![axis] === positions[index], "Upload changed another category's scroll position");
      }
      if (!cancelled) setResult(`PASS ${layout}: same nodes, independent scroll, free tab, upload isolation`);
    })().catch(error => { if (!cancelled) setResult(`FAIL ${layout}: ${String(error)}`); });
    return () => { cancelled = true; };
  }, [rows]);

  return <main style={{ padding: 16 }}>
    <p role="status">{result}</p>
    <div className="modeBody">
      <div className="promptBar" hidden={active !== "free"}><textarea aria-label="Free prompt" /></div>
      {modes.map(mode => <ReferenceList key={mode} rowRef={rows[mode]!} hidden={mode !== active}
        items={items.filter(item => item.mode === mode)} disabled={false} onUpload={() => {}} onSelect={() => {}} />)}
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(layout ? <Checks /> : <main>
  <h1>Reference list scroll retention checks</h1>
  {["mobile", "desktop"].map(mode => <iframe key={mode} title={mode}
    src={`?layout=${mode}`} width={mode === "mobile" ? 390 : 1000} height={350} style={{ display: "block" }} />)}
</main>);
