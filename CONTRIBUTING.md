# Contributing

This document outlines how to report bugs, suggest features, and submit code changes.

## How to Contribute

### Reporting Bugs

Check existing issues before opening a new one. If a new bug is found, open an issue and include:

- A summary of the problem.
- Steps to reproduce the bug.
- The `.rogen.json` file and folder structure, if applicable.
- Expected behavior versus actual results.

### Suggesting Features

To suggest an improvement or new feature:

- Open a feature request issue.
- Explain the problem the idea solves.
- Describe how the feature should work.

### Submitting Code Changes

Fork the repository, create a feature branch, and write unit tests for any changes. Ensure that `npm test` and `npm run lint` pass before opening a Pull Request against `main`.

## Local Development

Follow these steps to set up Rogen locally and make changes.

### 1. Prerequisites

Install Node.js on the system.

### 2. Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/Playfully/rogen.git
cd rogen
npm install
```

### 3. Building

Compile the TypeScript source code:

```bash
npm run build
```

### 4. Running Tests and Linter

Rogen uses Jest for testing and ESLint for code quality:

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch

# Check for linting errors
npm run lint

# Fix linting errors automatically
npm run lint:fix
```

## Releasing

`package.json` holds the version. Bump it with `npm version`, which also updates
the schema URL in `src/domain/config/config.ts` and, for a stable release, the
Rokit pin in the install docs, then commits and tags:

```bash
npm version 2.0.0          # a stable release
npm version 2.1.0-beta.1   # a pre-release
npm version prerelease     # 2.1.0-beta.1 -> 2.1.0-beta.2
git push --follow-tags
```

If the bump fails, nothing is committed or tagged, but `package.json` and
`package-lock.json` already hold the new version: restore them with
`git checkout -- package.json package-lock.json` before trying again.

Pushing the tag publishes the JSON schema, builds the binaries into a GitHub
release, and then publishes the npm package. A tag that doesn't match
`package.json` publishes nothing. A version with a `-` is a pre-release: GitHub
marks it so, and npm publishes it under the `next` tag, leaving `latest` on the
newest stable release.

npm accepts the publish through trusted publishing, so there's no token to
keep. It's set on npmjs.com under the package's Settings → Trusted Publisher:
GitHub Actions, user `LDGerrits`, repository `rogen`, workflow `release.yml`.

## Building Release Binaries

Rogen bundles source code with `esbuild` and packages standalone executables for Windows, Linux, and macOS using `pkg`.

### Creating a Local Release Build

To build binaries locally:

```bash
npm run release:local
```

This generates `dist/bundle.cjs` and outputs executables for all platforms into the `releases/` directory.

### Bundling Without Packaging

To generate only the JavaScript bundle without compiling binaries:

```bash
npm run bundle
```

This outputs `dist/bundle.cjs`.
