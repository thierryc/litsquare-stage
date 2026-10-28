import { createAudioController } from "./audio.js";
import { registerPreview } from "./preview-lifecycle.js";
import type { Runner } from "./runner.js";
import { resolveFrameTiming } from "./timing.js";
import type { FrameContext, LitSquareStageAudioModule, PlaybackMode } from "./types.js";

export interface BrowserHostOptions {
  fps: number;
  width: number;
  height: number;
  durationFrames?: number;
  loop?: boolean;
  autoplay?: boolean;
  mode?: PlaybackMode;
  audio?: LitSquareStageAudioModule;
}

export interface BrowserHostController {
  play(): void;
  pause(): void;
  seek(frame: number): Promise<FrameContext>;
  destroy(): Promise<void>;
  isPlaying(): boolean;
}

export function attachBrowserHost(runner: Runner, options: BrowserHostOptions): BrowserHostController {
  const normalized = {
    loop: true,
    autoplay: true,
    mode: "live" as PlaybackMode,
    ...options
  };

  let playing = false;
  let exporting = false;
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let rafId: number | null = null;
  let renderChain: Promise<FrameContext> = Promise.resolve(runner.getCurrentContext());
  let playbackOriginNow = 0;
  let playbackOriginTime = 0;

  const audioController = createAudioController(
    normalized.audio ? { audio: normalized.audio } : {}
  );

  const stopPlaybackLoop = () => {
    if (endTimer !== null) { clearTimeout(endTimer); endTimer = null; }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const reportRenderFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    playing = false;
    stopPlaybackLoop();
    void audioController?.pause(runner.getCurrentContext()).catch(() => {});
    console.error(`[stage] Browser host render failed: ${message}`);
  };

  const currentTiming = () => resolveFrameTiming(
    runner.getCurrentContext(),
    timingOptions(normalized.fps, normalized.durationFrames)
  );

  const buildContext = (frame: number, time: number): FrameContext => {
    const currentContext = runner.getCurrentContext();
    const timing = resolveFrameTiming(
      currentContext,
      timingOptions(normalized.fps, normalized.durationFrames)
    );

    return {
      ...currentContext,
      frame,
      time,
      fps: timing.fps,
      durationFrames: timing.durationFrames,
      width: normalized.width,
      height: normalized.height,
      dpr: window.devicePixelRatio || currentContext.dpr || 1,
      mode: normalized.mode
    };
  };

  const queueFrameContext = (nextContext: FrameContext) => {
    const queuedRender = renderChain
      .catch(() => runner.getCurrentContext())
      .then(async () => {
        if (destroyed) {
          throw new Error("Browser host has already been destroyed");
        }

        if (exporting) return runner.getCurrentContext();
        const context = await runner.setFrameContext(nextContext);
        await audioController?.setFrameContext(context);
        return context;
      });

    renderChain = queuedRender.then(
      (context) => context,
      (error) => {
        if (!destroyed) reportRenderFailure(error);
        return runner.getCurrentContext();
      }
    );

    return queuedRender;
  };

  const renderFrameAt = (frame: number, time: number) => {
    return queueFrameContext(buildContext(frame, time));
  };

  const tick = (now: number) => {
    if (!playing) {
      return;
    }

    const timing = currentTiming();
    let nextTime = playbackOriginTime + (now - playbackOriginNow) / 1000;
    let nextFrame = Math.floor(nextTime * timing.fps);

    if (nextTime >= timing.durationSeconds) {
      if (normalized.loop && timing.durationSeconds > 0) {
        nextTime %= timing.durationSeconds;
        playbackOriginNow = now;
        playbackOriginTime = nextTime;
        nextFrame = Math.floor(nextTime * timing.fps);
      } else {
        playing = false;
        stopPlaybackLoop();
        void audioController?.pause(buildContext(timing.maximumFrameIndex, timing.maximumFrameIndex / timing.fps)).catch(() => {});
        void renderFrameAt(timing.maximumFrameIndex, timing.maximumFrameIndex / timing.fps);
        return;
      }
    }

    nextFrame = Math.min(nextFrame, timing.maximumFrameIndex);

    void renderFrameAt(nextFrame, nextTime)
      .catch(() => {})
      .finally(() => {
        if (playing && !destroyed) {
          rafId = requestAnimationFrame(tick);
        }
      });
  };

  const controller: BrowserHostController = {
    play() {
      if (playing || destroyed || exporting) {
        return;
      }

      const currentContext = runner.getCurrentContext();
      playing = true;
      playbackOriginNow = performance.now();
      playbackOriginTime = currentContext.time;
      stopPlaybackLoop();
      void audioController?.play(currentContext).then(async () => {
        // A pending play() must not revive sound after pause/export/teardown.
        if (!playing || destroyed || exporting) await audioController?.pause(runner.getCurrentContext());
      }).catch(() => {});
      if (!normalized.loop) {
        const remaining = Math.max(0, currentTiming().durationSeconds - currentContext.time);
        endTimer = setTimeout(() => controller.pause(), remaining * 1000);
      }
      rafId = requestAnimationFrame(tick);
    },
    pause() {
      playing = false;
      stopPlaybackLoop();
      void audioController?.pause(runner.getCurrentContext()).catch(() => {});
    },
    async seek(frame) {
      const shouldResume = playing;
      controller.pause();

      const timing = currentTiming();
      const nextFrame = Math.max(0, Math.min(frame, timing.maximumFrameIndex));
      const nextTime = nextFrame / timing.fps;
      const context = await renderFrameAt(nextFrame, nextTime);
      await audioController?.seek(context);

      if (shouldResume) {
        controller.play();
      }

      return context;
    },
    async destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      unregisterPreview();
      documentTarget?.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      controller.pause();
      await renderChain.catch(() => runner.getCurrentContext());
      await audioController?.destroy();
      await runner.destroy();
    },
    isPlaying() {
      return playing;
    }
  };

  const unregisterPreview = registerPreview(runner, async () => {
    exporting = true;
    controller.pause();
    await renderChain;
    await audioController?.pause(runner.getCurrentContext());
  }, () => { exporting = false; });
  const documentTarget = typeof document === "undefined" ? null : document;
  const onVisibilityChange = () => { if (documentTarget?.hidden) controller.pause(); };
  const onPageHide = () => controller.pause();
  documentTarget?.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);

  void renderFrameAt(runner.getCurrentContext().frame, runner.getCurrentContext().time).catch(() => {});
  void audioController?.preload(runner.getCurrentContext()).catch(() => {});

  if (normalized.autoplay) {
    controller.play();
  }

  return controller;
}

function timingOptions(fps: number, durationFrames: number | undefined) {
  return {
    fps,
    ...(durationFrames === undefined ? {} : { durationFrames })
  };
}
