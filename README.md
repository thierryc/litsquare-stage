# LitSquare Stage

**Code motion. Render exact frames.**

LitSquare Stage is a public TypeScript runtime for deterministic, frame-driven web animation. Build a normal browser project with HTML, CSS, TypeScript, Canvas, SVG, Three.js, WebGPU, or React; drive every visible state from a `FrameContext`; then let a compatible render host ask the same project for exact frames.

This repository publishes only the public runtime packages:

- `@litsquare/stage`: host-agnostic frame runner, browser preview host, render-host bridge, timing, and audio helpers.
- `@litsquare/stage-react`: React provider and hooks for runner-driven views.
- `@litsquare/stage-protocol`: shared project config, render job, artifact, and MCP protocol types.

## What You Can Build

- Social launch videos, square posts, vertical cutdowns, and campaign variants.
- Product films with 3D or procedural motion, camera moves, and feature callouts.
- Data-driven weather, sports, finance, real-estate, and localized ad packs.
- Event signage, LED wall loops, sponsor rotations, countdowns, and wayfinding.
- Typography systems, title cards, SVG morphs, shader loops, and generative visuals.
- Figma-derived motion studies and branded design-system animations.

## Install

```bash
pnpm add @litsquare/stage
pnpm add @litsquare/stage-react react
pnpm add @litsquare/stage-protocol
```

Install only what your project needs. Most browser projects start with `@litsquare/stage`; React projects add `@litsquare/stage-react`; render hosts and tools use `@litsquare/stage-protocol`.

## How It Works

1. Define output settings in `stage.config.json`: preview size, render size, frame rate, duration, output format, and optional motion blur.
2. Build a normal web project with a full-frame `#stage` root.
3. Create a LitSquare Stage runner around a sketch with `setup`, `renderFrame`, and optional export lifecycle hooks.
4. Derive every visible state from `FrameContext`: frame, time, fps, duration, width, height, device pixel ratio, and mode.
5. Preview in the browser; render through any compatible host that implements the public bridge/protocol.

The important rule: final motion comes from frame-derived state, not from wall-clock browser playback.

Browser preview pauses when its page is hidden or leaves the page. Export preparation stops preview playback and audio before capturing frames; after export finishes, playback remains paused until explicitly started again. This keeps preview audio separate from offline audio generation and avoids background playback depending on animation-frame callbacks.

## Quick Start

From this workspace:

```bash
pnpm install
pnpm --filter @litsquare/stage-example-basic-dom dev
```

Open the Vite URL to preview the basic DOM example. In another terminal, build the example:

```bash
pnpm --filter @litsquare/stage-example-basic-dom build
```

For a fuller walkthrough, see [Quickstart](docs/quickstart.md).

## Project Shape

A typical LitSquare Stage project keeps source, assets, data, build output, and renders separate:

```text
my-stage/
  stage.config.json
  index.html
  package.json
  src/
    main.ts
    styles.css
  assets/
  data/
  dist/
  renders/
```

`src/main.ts` creates the runner, attaches browser preview, attaches render-host bridge support, and implements a sketch whose `renderFrame(ctx)` updates the visible scene. `assets/` holds local images, video, fonts, models, and audio. `data/` holds local snapshots for data-driven variants.

See [Project Anatomy](docs/project-anatomy.md) for the full file contract.

## Render Flow

The render path is intentionally explicit:

1. Build the web project.
2. Confirm `stage.config.json` points at the built output.
3. Ensure fonts, assets, and data snapshots are local and ready.
4. Connect a compatible render host to the runtime bridge.
5. Capture stills or short frame ranges before rendering the final video.
6. Review progress, logs, diagnostics, and artifacts from the host.

The public packages define the runtime bridge and shared protocol; renderer implementation, deployment, queueing, capture, and authentication are host responsibilities. See [Rendering](docs/rendering.md).

## Examples

This repository includes small workspace examples:

| Example | Best for | What it teaches |
| --- | --- | --- |
| Basic DOM | Launch posts, cards, simple story sequences | Frame-derived DOM layout and timed content |
| React | React-authored animation views | Provider/hooks integration with the runner |

See [Examples](docs/examples.md) for commands and starter patterns.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm build:examples
```

## Release

See [Releasing](RELEASING.md) for manual npm.org package checks, publishing, and push steps.

## Learn More

- [How It Works](docs/how-it-works.md)
- [Project Anatomy](docs/project-anatomy.md)
- [Rendering](docs/rendering.md)
- [Examples](docs/examples.md)
- [Common Mistakes](docs/common-mistakes.md)
- [Production Pipeline](docs/production-pipeline.md)
- [Architecture](docs/architecture.md)

## License

MIT
