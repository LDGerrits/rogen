---
name: rogen
description: Work in a Roblox repo that uses Rogen, which generates Rojo project files from the folder layout. Use when adding, moving or renaming source files, or when a *.rogen.json or *.project.json file is present.
---

# Working with Rogen

1. Rogen generates `*.project.json` from the folder layout. Never edit that file; edit the config or its `template`.
2. Read `*.rogen.json` for `routes` and `tags`: the only keys that route or tag.
3. Put a new file where the repo's existing layout would put it. Where there is none, use routing folders. `.server` and `.client` set the script class, not the route.
4. `Foo.<tag>.luau` or a `<tag>/` folder is a variant that replaces `Foo` when the tag is active.
5. After adding, moving or renaming files, run `rogen build` (safe while `watch` runs), and fix the diagnostics it prints.
6. For anything else, run `rogen help`.
