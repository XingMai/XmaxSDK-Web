import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePopoverInteraction } from "../src/usePopoverInteraction";

const { effects, useRef } = vi.hoisted(() => ({ effects: [], useRef: vi.fn() }));
vi.mock("react", () => ({
  useRef,
  useEffect: (effect) => effects.push(effect),
}));

beforeEach(() => {
  effects.length = 0;
  useRef.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function setup(open = true) {
  const listeners = new Map();
  const document = {
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    }),
  };
  vi.stubGlobal("document", document);

  const inside = {};
  const focusTarget = { focus: vi.fn() };
  const root = { contains: (target) => target === inside, querySelector: vi.fn(() => focusTarget) };
  const button = { focus: vi.fn() };
  const onOpenChange = vi.fn();
  useRef.mockReturnValueOnce({ current: root }).mockReturnValueOnce({ current: button });
  const control = usePopoverInteraction({ open, initialFocus: '[aria-checked="true"]', onOpenChange });
  const cleanup = effects[0]();

  return { listeners, document, inside, focusTarget, root, button, onOpenChange, control, cleanup };
}

it("does not register listeners or move focus while closed", () => {
  const state = setup(false);
  expect(state.document.addEventListener).not.toHaveBeenCalled();
  expect(state.focusTarget.focus).not.toHaveBeenCalled();
});

it("focuses the requested control on opening", () => {
  const state = setup();
  expect(state.root.querySelector).toHaveBeenCalledWith('[aria-checked="true"]');
  expect(state.focusTarget.focus).toHaveBeenCalledOnce();
});

it("ignores internal pointer events and closes for outside clicks without stealing focus", () => {
  const state = setup();
  state.listeners.get("pointerdown")({ target: state.inside });
  expect(state.onOpenChange).not.toHaveBeenCalled();

  state.listeners.get("pointerdown")({ target: {} });
  expect(state.onOpenChange).toHaveBeenCalledWith(false);
  expect(state.button.focus).not.toHaveBeenCalled();
});

it("closes on Escape and returns focus to the trigger", () => {
  const state = setup();
  state.listeners.get("keydown")({ key: "ArrowDown" });
  expect(state.onOpenChange).not.toHaveBeenCalled();

  state.listeners.get("keydown")({ key: "Escape" });
  expect(state.onOpenChange).toHaveBeenCalledWith(false);
  expect(state.button.focus).toHaveBeenCalledOnce();
});

it("preserves transient slider focus and closes only for a known external focus target", () => {
  const state = setup();
  state.control.onBlur({ currentTarget: state.root, relatedTarget: null });
  state.control.onBlur({ currentTarget: state.root, relatedTarget: state.inside });
  expect(state.onOpenChange).not.toHaveBeenCalled();

  state.control.onBlur({ currentTarget: state.root, relatedTarget: {} });
  expect(state.onOpenChange).toHaveBeenCalledWith(false);
});

it("removes exactly its own listeners on closing or unmounting", () => {
  const state = setup();
  expect(state.listeners.size).toBe(2);
  state.cleanup();
  expect(state.listeners.size).toBe(0);
  expect(state.document.removeEventListener.mock.calls).toEqual(state.document.addEventListener.mock.calls);
});
