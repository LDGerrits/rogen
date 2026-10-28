# Rogen

Rogen is a superset of Rojo that generates Rojo project files from your file system. A config such as `default.rogen.json` is a Rojo project file with Rogen's keys (`routes`, `sourcePaths`, `compiledPath`), and Rogen writes `default.project.json` from it. It runs Rojo's own commands (`serve`, `build`, `sourcemap`, `syncback`, ...) with Rojo's flags, after writing the project file. Rogen should behave as Rojo does wherever Rojo has a behaviour, so check Rojo's own behaviour before you change one of those commands.

The [README](README.md) says what Rogen is for, and the [docs](https://rogen-roblox.vercel.app/docs/v2) say how it is used. [CONTRIBUTING.md](CONTRIBUTING.md) is the contributor guide: setup, scripts, and where each kind of test belongs. Read it before you change code.

## Layout

```
src/
├── base/        # helpers that import nothing else from src: paths, globs, JSON, events, results
├── platform/    # services that reach the outside world: file system, processes, prompts, logging
├── domain/      # what Rogen knows: config, routing, writing, Rojo, serve, syncback, init
├── commands/    # one folder per CLI command, which parses its flags and prints
└── main.ts      # the composition root: picks each service's implementation and imports every command
e2e/             # cases run against the bundled CLI and a real Rojo
scripts/         # build, generate, release and test helpers
help/            # topics for `rogen help`
templates/       # the files `rogen init` writes
skills/rogen/    # the rules and skill Rogen gives to coding agents in users' projects
docs/            # the website (Next.js and Fumadocs)
```

## Rules the checks enforce

`npm run lint` and the tests in `src/__tests__` fail when these break, and their messages say what to do.

- A layer imports only the layers below it: `base`, then `platform`, then `domain`, then `commands`.
- Another module is imported only through its public files, which `eslint.config.js` lists. A domain module imports only the domain modules its `domainDependencies` entry names.
- Only `platform` implementations reach the outside world (`fs`, `child_process`, `os`, the network, chokidar). Everything else asks a platform service. In `base`, `domain` and `commands`, `process` and `console` are off limits; use a platform service and `LogService`.
- Code depends on a platform service's contract file, never on an implementation (`core-*`, `disk-*`, `native-*`, ...). Only `main.ts` and tests name one.
- A file is named for what it holds: its name matches an export, its module, or `*-command`.
- No import cycles, between files or between modules.
- A class lists its fields, then its constructor, then its methods.
- Every command is imported by `main.ts`, and every service a command asks for is set there.

## Generated files

`npm run generate` writes the help texts (from `help/*.md`), the agent rules and hook (from `skills/rogen` and the docs' agents page) and the `rogen init` templates into files that git ignores. Never edit or commit those files; change their sources. Every script that builds or tests regenerates them first.

## Working on a change

- While working, run `npm run test:changed`, or `npm run test:unit -- <folder>`.
- `npm run test:e2e` builds the bundle and runs the end-to-end cases against Rojo, which `rokit install` installs. When you change printed output on purpose, `npm run test:e2e:update` rewrites the transcripts. Read the summary it prints, and don't edit `expected.txt` files by hand.
- A new diagnostic code needs a section on the docs' diagnostics page, and a test checks that it has one.
- Run Prettier only on the files you changed. Formatting the whole tree touches files you didn't mean to change.
- Match the code around you: its naming, its idioms and how much it comments.
- Before you open a pull request, run `npm run check`, which runs the linter, the build, the type checks and every test.
