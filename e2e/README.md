# End-to-end tests

Each case is a small project that the bundled CLI builds for real, followed by
`rojo sourcemap` on every project file the run wrote. The transcript (commands,
exit codes, output, written files and the tree Rojo sees) is compared with
`expected.txt`.

```
e2e/cases/<area>/<case>/
  project/       copied to a temp directory and used as the working directory
  case.json      optional: { "steps": [["build", "--variant", "mock"]], "cwd": "src", "links": {}, "rojo": false, "show": [] }
  expected.txt   the transcript
```

- `steps` defaults to `[["build"]]`. Each step is the argument list of one `rogen` run.
- `cwd` is a folder inside `project/` that every step runs from; the project root when omitted.
- `links` maps a path inside `project/` to a symlink target, created at run time so
  the fixtures work on any checkout.
- `show` lists other written files to print, for what a sourcemap can't show
  (like `$properties`).
- `rojo: false` skips the sourcemap for cases where Rojo can't read the output.
- Files that a run created or changed are listed under `written:`. `*.rogen.json`
  files are printed, and every `*.project.json` is passed to Rojo.

Rojo must be installed (`rokit install`). Without it the suite is skipped locally
and fails in CI. `serve-argon.test.ts` needs the Argon `rokit.toml` pins,
which `rokit install` installs too.

After changing behavior on purpose, regenerate the transcripts:

```
npm run test:e2e:update
```

It prints the edits to the transcripts, grouped, with the number of transcripts each is in:

```
28×  Declare variants [-under-]{+in+} "variants" in
 1×  + Wrote 2 files.
     in init/add-place-no-input
```

Read that list first, and open the diff of a transcript only for an edit you did not expect. `npm run test:e2e:diff` prints the list again for what is not yet committed.

`watch.test.ts`, `serve-rojo.test.ts` and `serve-argon.test.ts` cover the
long-running `watch` and `serve` commands, which a transcript can't describe. The
serve tests start the pinned Rojo or Argon on a random port.
