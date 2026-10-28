import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachBrowserHost, attachRenderHost, createRunner, STAGE_HOST_TO_RUNTIME_EVENT } from "../src/index.js";

class PreviewWindow extends EventTarget { devicePixelRatio = 1; location = { reload() {} }; }
class PreviewDocument extends EventTarget { hidden = false; }
let target: PreviewWindow;
let doc: PreviewDocument;

beforeEach(() => {
  vi.useFakeTimers();
  target = new PreviewWindow();
  doc = new PreviewDocument();
  vi.stubGlobal("window", target);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function preview() {
  const pause = vi.fn();
  const runner = createRunner({ root: {} as HTMLElement, sketch: { renderFrame() {} }, initialContext: { fps: 30, durationFrames: 30 } });
  const browser = attachBrowserHost(runner, { fps: 30, width: 320, height: 180, durationFrames: 30, loop: false, audio: { play() {}, pause } });
  return { runner, browser, pause };
}

describe("preview audio lifecycle", () => {
  it("stops on document hiding even when animation frames never fire", async () => {
    const { browser, pause } = preview();
    expect(browser.isPlaying()).toBe(true);
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(browser.isPlaying()).toBe(false);
    expect(pause).toHaveBeenCalled();
    await browser.destroy();
  });

  it("ends non-looping audio without waiting for the next animation frame", async () => {
    const { browser, pause } = preview();
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.isPlaying()).toBe(false);
    expect(pause).toHaveBeenCalled();
    await browser.destroy();
  });

  it("hands the runner to export and prevents preview playback from restarting", async () => {
    const { runner, browser, pause } = preview();
    const host = attachRenderHost(runner);
    target.dispatchEvent(new CustomEvent(STAGE_HOST_TO_RUNTIME_EVENT, { detail: { version: 1, type: "prepareExport", payload: {} } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(browser.isPlaying()).toBe(false);
    browser.play();
    expect(browser.isPlaying()).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    await runner.finishExport();
    browser.play();
    expect(browser.isPlaying()).toBe(true);
    host.destroy();
    await browser.destroy();
  });
});
