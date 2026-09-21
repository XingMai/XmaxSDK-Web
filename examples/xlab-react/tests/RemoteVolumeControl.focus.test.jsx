import { beforeEach, expect, it, vi } from "vitest";
import { RemoteVolumeControl } from "../src/RemoteVolumeControl";

const { setOpen } = vi.hoisted(() => ({ setOpen: vi.fn() }));

// 隔离 hooks，直接覆盖原生滑杆可能触发的空 relatedTarget 失焦事件。
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal(),
  useState: () => [true, setOpen],
  useRef: () => ({ current: null }),
  useId: () => "volume-test",
  useEffect: () => {},
}));

beforeEach(() => setOpen.mockClear());

function blur(relatedTarget, contains) {
  const element = RemoteVolumeControl({ volume: 0, onChange: () => {} });
  element.props.onBlur({ relatedTarget, currentTarget: { contains } });
}

it("keeps the popover open when a native slider blurs without a new focus target", () => {
  const contains = vi.fn(() => false);
  blur(null, contains);
  expect(setOpen).not.toHaveBeenCalled();
  expect(contains).not.toHaveBeenCalled();
});

it("keeps the popover open when focus stays inside the control", () => {
  blur({}, () => true);
  expect(setOpen).not.toHaveBeenCalled();
});

it("closes the popover when focus explicitly moves outside the control", () => {
  blur({}, () => false);
  expect(setOpen).toHaveBeenCalledWith(false);
});
