# Agent evals

This eval measures whether Rogen's agent rules (`skills/rogen/agent-rules.md`) change what a coding agent does. Each run starts Claude Code headless in a fresh project from `rogen init` and gives it one task. When the agent finishes, the script scores the files it left behind.

```bash
npm run bundle
npm run eval:agents -- --reps 2 --conditions none,agents
```

Each run costs about $0.08 with Sonnet. The default set is 40 runs, about $3.20. The eval doesn't run in CI, because it needs Claude Code, an account and money.

## What a run is

- **Layout:**
  - `folder`: the Greeter sample as `init` writes it, with `Server/`, `Client/` and `Shared/` folders.
  - `suffix`: the same code routed by name: `Greeter.server.luau`, `Greeting@shared.luau`.
- **Condition:**

  | Condition | What the project has |
  |---|---|
  | `none` | No agent rules. |
  | `agents` | The rules in `AGENTS.md`, as `init` writes them. |
  | `claude` | The same, plus a `CLAUDE.md` that imports `AGENTS.md`. |
  | `fallback` | The rules, plus a `"*"` route. |

- **Task:** one prompt from `tasks.json`. Most of them add or move code that must land on one side, and two of them add a feature folder.

Claude Code runs with an empty config folder (`CLAUDE_CONFIG_DIR`), so your own `CLAUDE.md`, skills, hooks and memory don't reach the agent. The script copies your credentials from `~/.claude/.credentials.json`. Where that file doesn't exist (macOS keeps them in the keychain), set `ANTHROPIC_API_KEY` instead.

## Scoring

A run passes when all four of these hold:
- `rogen check` exits 0;
- `default.project.json` is what `rogen write` would write;
- every `require` resolves to an instance in the tree;
- the agent never edited the project file by hand.

The script also records where each new file landed and which Rogen commands the agent ran.

`results.json` and the transcripts go into a temporary folder; the script prints its path. Results go stale with every model and every release, so summarise them, with the date, model and Rogen version, in the "What we measured" section of `docs/content/docs/v2/agents.mdx`, rather than committing them.
