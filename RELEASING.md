# Releasing

This repository contains three public packages:

- `@litsquare/stage-protocol`
- `@litsquare/stage`
- `@litsquare/stage-react`

The workspace root and examples stay private to npm. Publish packages manually to npm.org; there is no npm publish GitHub Action in this repository.

The Stage background-audio patch targets only `@litsquare/stage@0.1.1`. Publish `@litsquare/stage-protocol` and `@litsquare/stage-react` only after their separate compatibility review. Do not create a repository-wide release tag for a runtime-only patch. Use a package-specific tag if a tag is needed.

Published runtime patch: `@litsquare/stage@0.1.1` on 2026-10-27, registry SHA-1 `f85ae8f89a976e057cd6b5617748479e17949894`. Registry integrity matches the verified release tarball. All eight integration templates pass clean registry install/build/validation with pnpm 10.29.2.

Published runtime baseline: `@litsquare/stage@0.1.0` on 2026-07-16, registry SHA-1 `98622770e4c48518113b7023dd4ac465892b8ffd`.

## Repository Links

- Public runtime packages: https://github.com/thierryc/litsquare-stage
- Private macOS app: https://github.com/thierryc/litsquare-stage-macos
- Private Chromium renderer: https://github.com/thierryc/litsquare-stage-chromium
- Public integration plugin: https://github.com/thierryc/litsquare-stage-integrations

## Local Release Gates

Run these from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm build:examples
```

Then inspect package contents:

```bash
(cd packages/stage-protocol && npm pack --dry-run --json)
(cd packages/stage && npm pack --dry-run --json)
(cd packages/stage-react && npm pack --dry-run --json)
```

Confirm the tarballs contain only `dist`, `README.md`, `LICENSE`, and `package.json`, and confirm `@litsquare/stage-react` rewrites its packed dependency on `@litsquare/stage` to the release version.

## Runtime-Only npm.org Publish

The runtime patch is a manual npm.org publish of `@litsquare/stage@0.1.1`. It pauses hidden browser previews and stops preview audio before export. A prepared tarball is not a published package; verify the registry after npm two-factor approval.

1. Create or confirm access to the `@litsquare` npm scope.
2. Confirm npm login and 2FA readiness:

```bash
npm whoami
```

3. Run all local release gates.
4. Pack the runtime release tarball:

```bash
mkdir -p /tmp/litsquare-stage-npm
(cd packages/stage && pnpm pack --pack-destination /tmp/litsquare-stage-npm)
```

5. Publish the exact verified tarball with npm 2FA:

```bash
npm publish /tmp/litsquare-stage-npm/litsquare-stage-0.1.1.tgz --access public
```

6. Verify npm visibility and install from the registry in a clean temporary project:

```bash
npm view @litsquare/stage@0.1.1 version dist.integrity
npm install @litsquare/stage@0.1.1
```

7. Compare the registry integrity with the verified tarball, record publication, then refresh the integration templates and test their frozen lockfiles in clean projects.

## Manual Push Workflow

For release-prep documentation or package metadata changes:

```bash
git status -sb
pnpm check
pnpm test
pnpm build
pnpm build:examples
git add -A
git commit -m "Prepare public npm release"
git push origin main
```

Do not push private app, renderer, signing, deployment, host-adapter, or credential material to this public repository.
