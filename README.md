# opencode-ralph

An [OpenCode](https://opencode.ai) agent that works autonomously until the task is done.

## What it does

Ralph is a custom OpenCode agent that solves the "stops after each step" problem. It:

- **Loops autonomously** — re-invokes the agent until it signals completion with `<ralph>DONE</ralph>`
- **Keeps going** until the task is complete instead of pausing for confirmation
- **Runs tests, fixes errors, re-runs** in a loop without asking "should I continue?"
- **Interactive TUI** with fuzzy model search, dynamic thinking variants, session history
- **Discovers models dynamically** from your connected OpenCode providers via the SDK

## Install

### Build from source

Requires [Bun](https://bun.sh) v1.3+.

```bash
git clone https://github.com/ryanmccauley/opencode-ralph.git
cd opencode-ralph
bun install
bun build --compile --outfile bin/ralph src/index.ts
```

Add the binary to your PATH:

```bash
cp bin/ralph /usr/local/bin/ralph
# or symlink it
ln -s "$(pwd)/bin/ralph" /usr/local/bin/ralph
```

### Agent file

The `ralph.md` agent definition is bundled. Place it next to the binary or in your working directory — the tool finds it automatically.

## Usage

### Interactive TUI (no arguments)

```bash
ralph
```

Opens the interactive menu where you can:

- **New session** — pick a model (fuzzy search), choose a thinking variant, set max iterations, enter your prompt
- **Recent sessions** — browse past sessions, view logs, re-run with the same settings
- **Settings** — set default model, thinking variant, and max iterations
- **Refresh models** — force-refresh the model cache from OpenCode

### CLI mode (with a prompt)

```bash
ralph "Fix all failing tests"

ralph -m openrouter/anthropic/claude-opus-4.6 "Refactor the auth module"

ralph --thinking high "Solve this complex bug"

ralph --max-iter 5 "Add input validation to the API"

ralph --once "Explain the auth flow"
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-m, --model` | saved default or interactive | Model to use (provider/model-id) |
| `--thinking` | `off` | Thinking variant name (e.g. `low`, `high`, `max`) |
| `--max-iter` | `50` (or `$RALPH_MAX_ITER`) | Maximum loop iterations |
| `--once` | off | Run once without looping |
| `--refresh` | off | Force-refresh the model cache |
| `--tui` | auto | Open the interactive TUI |
| `-h, --help` | | Show help |

### Environment variables

| Variable | Description |
|----------|-------------|
| `RALPH_MODEL` | Default model (overridden by `-m`) |
| `RALPH_MAX_ITER` | Default max iterations (overridden by `--max-iter`) |

## How the loop works

Each `opencode run` invocation is a fresh session. Ralph handles persistence across sessions:

1. **Iteration 1**: Sends your original prompt to the agent
2. **Iteration 2+**: Sends "Continue working on the following task. Check the current state of the codebase and pick up where you left off: \<original prompt\>"
3. **After each iteration**: Checks the agent's output for `<ralph>DONE</ralph>`
4. **If found**: Exits successfully
5. **If not found**: Starts the next iteration (up to `--max-iter`)

## Model discovery

Ralph uses the [OpenCode SDK](https://www.npmjs.com/package/@opencode-ai/sdk) to dynamically discover all models from your connected providers. Nothing is hardcoded — model lists, thinking variants, and provider configs all come from OpenCode at runtime.

Models are cached to `~/.ralph/models.cache.json` with a 1-hour TTL for fast startup. Use `--refresh` or the "Refresh models" menu option to update.

## Thinking variants

Thinking/reasoning levels are discovered per-model from OpenCode's variant system. Different providers expose different variants:

| Provider | Example variants |
|----------|-----------------|
| OpenRouter | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| Anthropic | `low`, `high`, `max` |
| GitHub Copilot | `low`, `medium`, `high` |
| Google | `high`, `max` |

The variant config objects are passed through directly to the AI SDK — no translation layer.

## Permissions

By default Ralph has full autonomy:

| Tool | Permission |
|------|-----------|
| `edit` | `allow` — no prompts on file changes |
| `bash` | `allow` — runs shell commands without prompts |
| `webfetch` | `allow` — fetches URLs without prompts |

To customize, edit `ralph.md` and adjust the `permission` block. See the [OpenCode permissions docs](https://opencode.ai/docs/permissions/).

## Configuration

Settings are saved to `~/.ralph/config`. Session metadata and logs are stored in `~/.ralph/sessions/`.

| Setting | Value | Why |
|---------|-------|-----|
| `mode` | `primary` | Tab-switchable in TUI |
| `temperature` | `0.7` | Balanced creativity |
| `edit: allow` | No approval pauses | Core fix for the "stops each step" problem |

## Project structure

```
src/
  index.ts           # CLI parsing + TUI/CLI mode router
  types.ts           # Shared types (ModelInfo, Config, SessionMeta)
  core/
    agent.ts         # Agent .md file generation with variant config
    config.ts        # Config load/save (~/.ralph/config)
    models.ts        # SDK model discovery + caching + fuzzy search
    runner.ts        # opencode run subprocess loop
    sessions.ts      # Session metadata storage
  tui/
    menu.ts          # Main menu loop
    new-session.ts   # New session flow (model → thinking → prompt)
    sessions.ts      # Session browser
    settings.ts      # Settings editor
    theme.ts         # Monotone styling helpers
ralph.md             # Agent definition file
```

## License

MIT
