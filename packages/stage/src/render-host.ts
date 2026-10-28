import { createAudioController } from "./audio.js";
import { stopPreviewForExport } from "./preview-lifecycle.js";
import type { Runner } from "./runner.js";
import type { AudioRenderContext, FrameContext, LitSquareStageAudioModule } from "./types.js";

export const STAGE_BRIDGE_VERSION = 1 as const;
export const STAGE_HOST_TO_RUNTIME_EVENT = "litsquare-stage:host-to-runtime";
export const STAGE_RUNTIME_TO_HOST_EVENT = "litsquare-stage:runtime-to-host";

export type RuntimeSupportedCommand =
  | "setFrameContext"
  | "prepareExport"
  | "renderFrame"
  | "reloadProject"
  | "renderAudio"
  | "cancelAudioRender";

export interface BridgeEnvelope<Type extends string, Payload> {
  version: typeof STAGE_BRIDGE_VERSION;
  type: Type;
  payload: Payload;
}

export interface RuntimeReadyPayload {
  supportedCommands?: RuntimeSupportedCommand[];
}

export interface LogMessagePayload {
  level: "debug" | "info" | "warning" | "error";
  message: string;
}

export interface FrameRenderedPayload {
  frame: number;
  time: number;
}

export interface ExportPreparedPayload {}

export interface RenderFramePayload {
  context: FrameContext;
}

export interface AudioRenderRequestPayload extends AudioRenderContext {}

export interface CancelAudioRenderPayload {
  requestID: string;
}

export interface AudioRenderStartedPayload {
  requestID: string;
  sampleRate: number;
  channels: number;
  totalFrames: number;
  totalChunks: number;
  totalBytes: number;
  durationSeconds: number;
}

export interface AudioRenderChunkPayload {
  requestID: string;
  sampleRate: number;
  channels: number;
  totalFrames: number;
  chunkIndex: number;
  byteCount: number;
  dataBase64: string;
  done: boolean;
}

export interface AudioRenderCompletedPayload {
  requestID: string;
  hasAudio: boolean;
  sampleRate: number;
  channels: number;
  totalFrames: number;
  totalChunks: number;
  totalBytes: number;
  durationSeconds: number;
}

export interface AudioRenderFailedPayload {
  requestID: string;
  message: string;
}

export interface ReloadProjectPayload {
  projectName?: string;
}

export interface EmptyPayload {}

export type RuntimeEvent =
  | BridgeEnvelope<"runtimeReady", RuntimeReadyPayload>
  | BridgeEnvelope<"logMessage", LogMessagePayload>
  | BridgeEnvelope<"exportPrepared", ExportPreparedPayload>
  | BridgeEnvelope<"frameRendered", FrameRenderedPayload>
  | BridgeEnvelope<"audioRenderStarted", AudioRenderStartedPayload>
  | BridgeEnvelope<"audioRenderChunk", AudioRenderChunkPayload>
  | BridgeEnvelope<"audioRenderCompleted", AudioRenderCompletedPayload>
  | BridgeEnvelope<"audioRenderFailed", AudioRenderFailedPayload>;

export type HostCommand =
  | BridgeEnvelope<"setFrameContext", FrameContext>
  | BridgeEnvelope<"prepareExport", EmptyPayload>
  | BridgeEnvelope<"renderFrame", RenderFramePayload>
  | BridgeEnvelope<"reloadProject", ReloadProjectPayload>
  | BridgeEnvelope<"renderAudio", AudioRenderRequestPayload>
  | BridgeEnvelope<"cancelAudioRender", CancelAudioRenderPayload>;

export interface RenderHostOptions {
  audio?: LitSquareStageAudioModule;
  onReload?: () => void;
}

export interface RenderHostHandle {
  destroy(): void;
  emitLog(message: string, level?: LogMessagePayload["level"]): void;
}

const supportedCommands: RuntimeSupportedCommand[] = [
  "setFrameContext",
  "prepareExport",
  "renderFrame",
  "reloadProject",
  "renderAudio",
  "cancelAudioRender"
];

const audioRenderChunkBytes = 32 * 1024;

export function attachRenderHost(runner: Runner, options: RenderHostOptions = {}): RenderHostHandle {
  const target = resolveWindow();
  let destroyed = false;
  let activeAudioRender: { requestID: string; cancelled: boolean } | null = null;
  const audioController = createAudioController(options.audio ? { audio: options.audio } : {});

  const emit = (event: RuntimeEvent) => {
    if (destroyed) {
      return;
    }
    target.dispatchEvent(new CustomEvent(STAGE_RUNTIME_TO_HOST_EVENT, { detail: event }));
  };

  const emitLog = (message: string, level: LogMessagePayload["level"] = "info") => {
    emit({
      version: STAGE_BRIDGE_VERSION,
      type: "logMessage",
      payload: { level, message }
    });
  };

  const emitFrameRendered = (context: FrameContext) => {
    emit({
      version: STAGE_BRIDGE_VERSION,
      type: "frameRendered",
      payload: { frame: context.frame, time: context.time }
    });
  };

  const prepareExport = async () => {
    await stopPreviewForExport(runner);
    await audioController?.pause(runner.getCurrentContext());
    await runner.prepareExport();
    emit({
      version: STAGE_BRIDGE_VERSION,
      type: "exportPrepared",
      payload: {}
    });
    emitLog("Runtime prepared for export.", "debug");
  };

  const renderContext = async (context: Partial<FrameContext>) => {
    const nextContext = await runner.setFrameContext(context);
    await audioController?.pause(nextContext);
    emitFrameRendered(nextContext);
  };

  const emitAudioCompletedWithoutAudio = (payload: AudioRenderRequestPayload) => {
    emit({
      version: STAGE_BRIDGE_VERSION,
      type: "audioRenderCompleted",
      payload: {
        requestID: payload.requestID,
        hasAudio: false,
        sampleRate: payload.sampleRate,
        channels: payload.channels,
        totalFrames: 0,
        totalChunks: 0,
        totalBytes: 0,
        durationSeconds: 0
      }
    });
  };

  const renderAudio = async (payload: AudioRenderRequestPayload) => {
    const renderState = { requestID: payload.requestID, cancelled: false };
    activeAudioRender = renderState;

    try {
      if (!audioController) {
        emitAudioCompletedWithoutAudio(payload);
        return;
      }

      const audioBuffer = await audioController.renderOfflineAudio(payload);
      if (renderState.cancelled || activeAudioRender?.requestID !== payload.requestID) {
        return;
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        emitAudioCompletedWithoutAudio(payload);
        return;
      }

      await streamAudioBuffer(audioBuffer, payload.requestID, renderState, emit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        version: STAGE_BRIDGE_VERSION,
        type: "audioRenderFailed",
        payload: { requestID: payload.requestID, message }
      });
    } finally {
      if (activeAudioRender?.requestID === payload.requestID) {
        activeAudioRender = null;
      }
    }
  };

  const cancelAudioRender = (payload: CancelAudioRenderPayload) => {
    if (activeAudioRender?.requestID === payload.requestID) {
      activeAudioRender.cancelled = true;
      emitLog(`Cancelled audio render ${payload.requestID}.`, "debug");
    }
  };

  const handleCommand = (command: unknown) => {
    if (!isHostCommand(command) || destroyed || command.version !== STAGE_BRIDGE_VERSION) {
      return;
    }

    void (async () => {
      try {
        switch (command.type) {
          case "setFrameContext":
            await renderContext(command.payload);
            break;
          case "prepareExport":
            await prepareExport();
            break;
          case "renderFrame":
            await renderContext(command.payload.context);
            break;
          case "reloadProject":
            await audioController?.destroy();
            await runner.destroy();
            if (options.onReload) {
              options.onReload();
            } else {
              target.location.reload();
            }
            break;
          case "renderAudio":
            await renderAudio(command.payload);
            break;
          case "cancelAudioRender":
            cancelAudioRender(command.payload);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (command.type === "renderAudio") {
          emit({
            version: STAGE_BRIDGE_VERSION,
            type: "audioRenderFailed",
            payload: { requestID: command.payload.requestID, message }
          });
        }
        emitLog(`Failed to handle host command: ${message}`, "error");
      }
    })();
  };

  const eventHandler = (event: Event) => {
    handleCommand((event as CustomEvent<HostCommand>).detail);
  };

  target.addEventListener(STAGE_HOST_TO_RUNTIME_EVENT, eventHandler);

  emit({
    version: STAGE_BRIDGE_VERSION,
    type: "runtimeReady",
    payload: { supportedCommands }
  });
  emitLog("LitSquare Stage render host attached.", "debug");

  return {
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      target.removeEventListener(STAGE_HOST_TO_RUNTIME_EVENT, eventHandler);
      void audioController?.destroy().catch(() => {});
    },
    emitLog
  };
}

async function streamAudioBuffer(
  audioBuffer: AudioBuffer,
  requestID: string,
  renderState: { requestID: string; cancelled: boolean },
  emit: (event: RuntimeEvent) => void
) {
  const channels = Math.max(audioBuffer.numberOfChannels, 1);
  const totalFrames = audioBuffer.length;
  const bytesPerAudioFrame = channels * 2;
  const framesPerChunk = Math.max(1, Math.floor(audioRenderChunkBytes / bytesPerAudioFrame));
  const totalChunks = Math.max(1, Math.ceil(totalFrames / framesPerChunk));
  const totalBytes = totalFrames * bytesPerAudioFrame;

  emit({
    version: STAGE_BRIDGE_VERSION,
    type: "audioRenderStarted",
    payload: {
      requestID,
      sampleRate: audioBuffer.sampleRate,
      channels,
      totalFrames,
      totalChunks,
      totalBytes,
      durationSeconds: totalFrames / Math.max(audioBuffer.sampleRate, 1)
    }
  });

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    if (renderState.cancelled) {
      return;
    }

    const startFrame = chunkIndex * framesPerChunk;
    const frameCount = Math.min(framesPerChunk, totalFrames - startFrame);
    const pcm = encodePCM16Chunk(audioBuffer, startFrame, frameCount, channels);

    emit({
      version: STAGE_BRIDGE_VERSION,
      type: "audioRenderChunk",
      payload: {
        requestID,
        sampleRate: audioBuffer.sampleRate,
        channels,
        totalFrames,
        chunkIndex,
        byteCount: pcm.byteLength,
        dataBase64: base64Encode(pcm),
        done: chunkIndex === totalChunks - 1
      }
    });

    await Promise.resolve();
  }

  emit({
    version: STAGE_BRIDGE_VERSION,
    type: "audioRenderCompleted",
    payload: {
      requestID,
      hasAudio: true,
      sampleRate: audioBuffer.sampleRate,
      channels,
      totalFrames,
      totalChunks,
      totalBytes,
      durationSeconds: totalFrames / Math.max(audioBuffer.sampleRate, 1)
    }
  });
}

function encodePCM16Chunk(audioBuffer: AudioBuffer, startFrame: number, frameCount: number, channels: number) {
  const bytes = new Uint8Array(frameCount * channels * 2);
  const view = new DataView(bytes.buffer);
  const channelData = Array.from({ length: channels }, (_, channel) => {
    const sourceChannel = Math.min(channel, audioBuffer.numberOfChannels - 1);
    return audioBuffer.getChannelData(sourceChannel);
  });

  let byteOffset = 0;
  for (let frameOffset = 0; frameOffset < frameCount; frameOffset += 1) {
    const frame = startFrame + frameOffset;
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel]?.[frame] ?? 0));
      const pcm = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(byteOffset, Math.round(pcm), true);
      byteOffset += 2;
    }
  }

  return bytes;
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += audioRenderChunkBytes) {
    const chunk = bytes.subarray(offset, offset + audioRenderChunkBytes);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function resolveWindow(): Window {
  if (typeof window === "undefined") {
    throw new Error("attachRenderHost requires a browser Window.");
  }
  return window;
}

function isHostCommand(command: unknown): command is HostCommand {
  if (!command || typeof command !== "object") {
    return false;
  }
  const candidate = command as Partial<HostCommand>;
  return (
    typeof candidate.version === "number" &&
    typeof candidate.type === "string" &&
    "payload" in candidate
  );
}
