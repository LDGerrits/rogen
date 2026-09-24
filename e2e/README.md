# End-to-end tests

Each case is a small project that the bundled CLI builds for real, followed by
`rojo sourcemap` on every project file the run wrote. The transcript (commands,
exit codes, output, written files and the tree Rojo sees) is compared with
`expected.txt`.

```
e2e/cases/<area>/<case>/
  project/       copied to a temp directory and used as the working directory
  case.json      optional: { "steps": [["build", "--tag", "mock"]], "links": {}, "rojo": false }
  expected.txt   the transcript
```

- `steps` defaults to `[["build"]]`. Each step is the argument list of one `rogen` run.
- `links` maps a path inside `project/` to a symlink target, created at run time so
  the fixtures work on any checkout.
- `rojo: false` skips the sourcemap for cases where Rojo can't read the output.
- Files that a run created or changed are listed under `written:`. `*.rogen.json`
  files are printed, and every `*.project.json` is passed to Rojo.

Rojo must be installed (`rokit install`). Without it the suite is skipped locally
and fails in CI.

After changing behavior on purpose, regenerate and review the diff:

```
UPDATE_E2E=1 npm test -- e2e
```

`watch.test.ts` covers the long-running `watch` command, which a transcript
can't describe.
