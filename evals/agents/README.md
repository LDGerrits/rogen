# Agent evals

This eval measures whether Rogen's agent rules (`skills/rogen/agent-rules.md`) change what a coding agent does. Each run starts Claude Code headless in a fresh project from `rogen init` and gives it one task. When the agent finishes, the script scores the files it left behind.

```bash
npm run bundle
npm run eval:agents -- --reps 2 --conditions none,agents --model haiku
```

Each run costs about $0.08 with Sonnet and about $0.01 with Haiku. The default set is 52 runs. The eval doesn't run in CI, because it needs Claude Code, an account and money.

## What a run is

- **Layout:**
  - `folder`: the Greeter sample as `init` writes it, with `server/`, `client/` and `shared/` folders.
  - `suffix`: the same code routed by name: `Greeter.server.luau`, `Greeting@shared.luau`.
  - `rbxts`: a roblox-ts project from `rogen init --places`, with a second place, `lobby`, beside `game`, both reading the shared code in `projects/common`. It needs the network once, to install the packages, which every run then shares.
- **Condition:**

  | Condition | What the project has |
  |---|---|
  | `none` | No agent rules. |
  | `agents` | The rules in `AGENTS.md`, as `init` writes them. |
  | `claude` | The same, plus a `CLAUDE.md` that imports `AGENTS.md`. |
  | `fallback` | The rules, plus a `"*"` route. |
  | `short` | Five lines of rules in `AGENTS.md`, without the markers so `rogen write` keeps them. |
  | `proposed` | A shorter block of rules than `init` writes, without the markers. |

- **Task:** one prompt from `tasks.json`. Most of them add or move code that must land on one side, and two of them add a feature folder. A plain prompt runs in the Luau layouts; a task with a `layout` runs only in that one, and its `lands` names the new files and the service they must land under.

Claude Code runs with an empty config folder (`CLAUDE_CONFIG_DIR`), so your own `CLAUDE.md`, skills, hooks and memory don't reach the agent. The script copies your credentials from `~/.claude/.credentials.json`. Where that file doesn't exist (macOS keeps them in the keychain), set `ANTHROPIC_API_KEY` instead.

## Scoring

A run passes when all four of these hold:
- `rogen check` exits 0;
- `default.project.json` is what `rogen write` would write;
- every `require` resolves to an instance in the tree;
- the agent never edited the project file by hand.

In `rbxts`, a run passes when, for every place, `rogen check` on its config exits 0, its project file is what `rogen write` would write, and `rbxtsc` compiles it; the agent never edited a project file by hand; and each new file the task's `lands` names lands under its service in every place.

The script also records where each new file landed and which Rogen commands the agent ran.

`results.json` and the transcripts go into a temporary folder; the script prints its path. Results go stale with every model and every release, so summarise them, with the date, model and Rogen version, in the pull request that changes the rules, rather than committing them.
