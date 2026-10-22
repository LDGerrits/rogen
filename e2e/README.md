# End-to-end tests

Each case is a small project that the bundled CLI builds for real, followed by
`rojo sourcemap` on every project file the run wrote. The transcript (commands,
exit codes, output, written files and the tree Rojo sees) is compared with
`expected.txt`.

A case is about one thing, and its transcript shows that thing. The printed
output of `build` and `init` is the same frame in nearly every case, so it is
left out (`stdout: (not shown)`) unless the case lists the command under
`output`. Errors and warnings are on stderr and always show, and so do the exit
code, the written files and the tree Rojo sees.

```
e2e/cases/<area>/<case>/
  project/       copied to a temp directory and used as the working directory
  case.json      optional: { "steps": [["build", "lobby", "match"]], "cwd": "src", "links": {}, "rojo": false, "show": [], "output": [], "env": {}, "place": "place.rbxl", "network": false }
  place.luau     with "place": what changed in Studio, run on the place built from project/
  expected.txt   the transcript
```

- `steps` defaults to `[["build"]]`. Each step is the argument list of one `rogen` run. A
  project is a folder with its own `default.rogen.json`, so a case with several holds a
  folder for each, and a step names the folders (`["build", "lobby", "match"]`).
- `cwd` is a folder inside `project/` that every step runs from; the project root when omitted.
- `links` maps a path inside `project/` to a symlink target, created at run time so
  the fixtures work on any checkout.
- `show` lists other written files to print, for what a sourcemap can't show
  (like `$properties`).
- `output` lists the commands (`build`, `init`) whose printed output this case
  checks. `--json` and `--help` output always shows.
- `rojo: false` skips the sourcemap for cases where Rojo can't read the output.
- `env` sets variables for the commands, on top of an environment that is not GitHub Actions'.
- A step that starts with `$` runs a program between the `rogen` runs, such as
  `["$", "darklua", "process", "src", "dist"]`. Its output is left out of the transcript.
- `tools` maps a name to the body of a shell script that stands in for a toolchain
  program (`rokit`, `aftman`, `foreman`, `rojo`, `curl`), for a machine that has none:
  the case's PATH loses every folder that holds a real one, its home folder is empty,
  and the project gets no `rokit.toml` pinning Rojo. Each script logs its call, and
  the calls are in the transcript under `ran:`. Use `"rojo": false` with it, since the
  sourcemap step needs the real Rojo.
- `network: true` marks a case whose steps download packages (`npm create roblox-ts`, `npx rbxtsc`). It runs only with `ROGEN_E2E_NETWORK=1`, and its steps may take three minutes. The transcript lists every file the tools write (not `node_modules`), so a new version of create-roblox-ts that writes another file changes it.
- `stdin` is the text every step reads on its standard input; the transcript shows it under `stdin:`.
- `place` makes a place file before the steps run, at that path inside the project:
  the project is built and synced into a place by `rojo build`, then `place.luau`
  changes it with [Lune](https://github.com/lune-org/lune) (pinned in `rokit.toml`),
  with `game` and `Instance` as in Studio's command bar. A `.rbxlx` name saves XML.
  This is how syncback cases say what an edit in Studio was, with no place file to
  keep in step with `project/` by hand. It builds `default.project.json` from the
  project root, so a case with `place` takes no `links` or `cwd`.
- Files that a run created or changed are listed under `written:`. `*.rogen.json` and
  `*.rogen.jsonc` files are printed, and every `*.project.json` is passed to Rojo.

`rojo-conformance.test.ts` is the other seam: Rojo's own build-test projects
(`rojo-build-tests/`, copied from Rojo at the pinned version by
`node scripts/vendor-rojo-tests.ts`) are each saved as a `default.rogen.json`, and
the `default.project.json` Rogen writes must equal the original apart from
`$schema`, with `rojo build` making the same place from both. A project Rogen
can't write back yet is listed in the test with what it needs; its test is
`it.failing`, so it fails the day that works and the mark has to go.

`rojo-parity.test.ts` runs Rojo and Rogen on the same project and compares what they make. Each of Rojo's
build-test projects is built into `.rbxl`, `.rbxm` and `.rbxlx` and mapped with each `sourcemap` flag, and the
files must be the same bytes. A plain Rojo project is edited in
Studio in twelve ways, and `rogen syncback -y` must leave the same files as `rojo syncback`.
Each of Rojo's syncback-test projects (`rojo-syncback-tests/`, vendored by the same script) is saved as a
`default.rogen.json`; `rogen syncback -y` must leave the same files as `rojo syncback` apart from the project file, and
`rogen syncback -n` must change none.

Rojo must be installed (`rokit install`). Without it the suite is skipped locally
and fails in CI.

## Where each thing is checked

Check a thing once, where it lives, and leave it out of the other cases.

- What `init` prints for each kind of project (its notes and next steps) is shown
  by the cases in `cases/init-output/`, which prove that the real binary prints
  it. The wording of each note is checked by
  `src/commands/init/__tests__/init-command.test.ts` and the tests of
  `src/domain/init`. The other `cases/init/` cases check what `init` writes and
  that Rojo accepts it.
- What `build` prints (header, per-project lines, closing line) is checked by
  `build-log.test.ts` and `build-command.test.ts` in
  `src/commands/build/__tests__/`. A case lists `build` under `output` only when
  a line of it is the point, such as the `same warnings as` note of several
  projects, the `-v` debug lines or the path forms `[PROJECT]` takes.
- The wording of a warning or an error is checked by the domain test of its code,
  such as `build-validator.test.ts`. A case shows it on stderr to prove that it
  reaches the user.
- The project file and the tree Rojo sees are checked by the case of the feature:
  `cases/routing` for how folders and names place a file, `cases/structure` for
  init folders, the tree, `globIgnorePaths` and a config without routes,
  `cases/data-files` for `.meta.json` and `.model.json`, `cases/links` for
  symlinks, `cases/compiled-path` for `compiledPath` (roblox-ts and Darklua output),
  and `cases/config` for the config file itself: its keys, the removed and unknown
  ones, `name`, the source paths and JSONC.
- Which file a command picks and writes, in a folder with several configs
  (`default.rogen.json`, `dist.rogen.json`, `release.rogen.json`), is checked by
  `cases/projects`: the forms `[PROJECT]` takes (`name-argument`, `folder-wins-a-tie`,
  `plain-project-beside-config`), the default alone for a bare command (`default-only`,
  `no-default-error`), the "keep one" and renamed-config errors, a deleted config
  (`config-deleted-plain-project`), a stale file (`check-stale-project-warning`), `list`
  (`list-folder`), and the second files of Darklua and release setups.
- What a command does with its project argument, and what it prints, is
  checked by `cases/commands`: `build`, `check`, `list` and `where`, with
  several projects as folders (`build-several-projects`, `build-same-errors-error`),
  the forms `[PROJECT]` takes (`build-project-path`, `build-project-argument-error`,
  `from-subfolder`, which shows a bare command reading only its own folder), a stale `default.project.json` (`check-stale-project-file-warning`),
  `--json`, `--quiet`, `--verbose`, `--color`, help, and the unknown
  and removed commands and options.

A new case needs no `output`. Add it only when the printed output of `build` or
`init` is what the case is about.

## Updating transcripts

After changing behavior on purpose, regenerate the transcripts:

```
npm run test:e2e:update
```

It prints the edits to the transcripts, grouped, with the number of transcripts each is in:

```
28×  Run 'rogen build' [-to-]{+to bring+} it up to date
 1×  + Wrote 2 files.
     in init/lifted-project
```

Read that list first, and open the diff of a transcript only for an edit you did not expect. `npm run test:e2e:diff` prints the list again for what is not yet committed.

`watch.test.ts` and `serve-rojo.test.ts` cover the long-running `watch` and
`serve` commands, which a transcript can't describe. The serve tests start the
pinned Rojo on a random port.

## On Windows

The suite runs on Linux. To check a transcript on Windows, run the harness's `runCase` over every case with Windows' Node and compare with `expected.txt` after turning `\` into `/` and CRLF into LF. Four cases differ there, and are meant to:

- `commands/build-output-failed-error`, `commands/build-output-json` and `commands/sourcemap-output` quote Rojo's own message for a missing folder, which names the operating system's error: `No such file or directory (os error 2)` on Linux, `The system cannot find the path specified. (os error 3)` on Windows.
- `commands/color-always` draws the frame with the ASCII characters (`T`, `|`) that the terminal layout falls back to where it does not detect Unicode support.
