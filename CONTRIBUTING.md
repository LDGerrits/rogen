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

Fork the repository, create a feature branch, and write unit tests for any changes. Ensure that `npm test` and `npm run lint` pass before opening a Pull Request against `main`. Leave the version alone: it changes only when a release is cut.

## Local Development

Follow these steps to set up Rogen locally and make changes.

### 1. Prerequisites

- Node.js 22.18 or newer. The scripts run TypeScript files directly, which older versions can't.
- [Rokit](https://github.com/rojo-rbx/rokit), for the Rojo version that `rokit.toml` pins. The tests that check output against Rojo are skipped without it.

### 2. Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/LDGerrits/rogen.git
cd rogen
npm install
rokit install
```

### 3. Building

Compile the TypeScript source code, which also type-checks it:

```bash
npm run build
```

To try the CLI, bundle it into `dist/bundle.cjs` and run that:

```bash
npm run bundle
node dist/bundle.cjs help
```

To try it on a Roblox project, run `node <path to rogen>/dist/bundle.cjs build` in that project.

`npm run release:local` turns the bundle into a standalone executable at `releases/rogen`, a Node single executable application. It builds for the platform it runs on.

### 4. Running Tests and Linter

Rogen uses Jest for testing and ESLint for code quality:

```bash
# Run tests once
npm test

# Run the unit tests that your uncommitted changes can affect
npm run test:changed

# Run tests in watch mode
npm run test:watch

# Check for linting errors
npm run lint

# Fix linting errors automatically
npm run lint:fix
```

Test a rule where it lives, and assert it once:

- Pure domain code (`src/domain`) owns the rules and their edge cases.
- A command test (`src/commands`) checks that the command is wired to its services and prints what it should. Build it with `commandHarness` where it can run over the in-memory file system, instead of constructing services by hand, so a change to a constructor touches one file.
- `e2e` cases show that a real Rojo accepts the output, one case per behavior a user sees. A transcript leaves out the printed output of `build` and `init` unless the case is about it, since the command tests own that; `e2e/README.md` says where each thing is checked.

Script prompts by question, as in `new MockPromptService({ Language: "roblox-ts" })`, so that every question you don't name takes its default. A question with no default, a named answer no question takes, or a question asked twice fails the test. A new question then breaks only the tests about the order of the questions. Use a list of answers only when the order is what the test checks.

While working, run `npm run test:changed`, the folder you touched (`npm run test:unit -- src/domain/init`) or `npm run test:unit` (about 5 seconds). To include what you already committed, run `npm run test:unit -- --changedSince=origin/main`. None of these run the end-to-end cases, which only the bundle can affect: `npm run test:e2e` builds the bundle and runs it against Rojo. Run `npm test`, which runs both, before you open a pull request.

When you change output on purpose, `npm run test:e2e:update` regenerates the end-to-end transcripts and sums up what changed, as the edited words and the number of transcripts each is in. Check that list instead of every diff; a line that only one or two transcripts have is the one to read.
