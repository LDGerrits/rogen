# Templates

The files `rogen init` writes into a new project: one folder per variant (`luau`, `luau-places`, `roblox-ts`, `roblox-ts-places`), laid out as the tree `init` writes, and `sample-game.json` with the sample game's nodes. `init` assembles the config around them (`default.rogen.json`, `.gitignore`, the editor and Darklua files) and fills `{{name}}`, `{{place}}`, `{{source}}` and `{{serve}}`. Nothing reads this folder at run time: run `npm run generate:templates` after an edit to embed it in `src/domain/init/starter-templates.ts`.
