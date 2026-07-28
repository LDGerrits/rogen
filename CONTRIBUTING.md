# Contributing

This document outlines how to report bugs, suggest features, and submit code changes.

## How to Contribute

### Reporting Bugs

Check existing issues before opening a new one. If you find a new bug, open an issue and include:

- A summary of the problem.
- Steps to reproduce the bug.
- Your `.rogen.json` file and folder structure, if applicable.
- Expected behavior versus what happened.

### Suggesting Features

To suggest an improvement or new feature:

- Open a feature request issue.
- Explain the problem your idea solves.
- Describe how the feature should work.

### Submitting Code Changes

Fork the repository, create a feature branch, and write unit tests for your changes. Make sure that `npm test` and `npm run lint` pass before opening a Pull Request against `main`.

## Local Development

Follow these steps to set up Rogen locally and make changes.

### 1. Prerequisites

Install Node.js on your computer.

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

## Building Release Binaries

Rogen bundles its code with `esbuild` and packages standalone executables for Windows, Linux, and macOS using `pkg`.

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
