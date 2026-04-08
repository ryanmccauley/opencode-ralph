# opencode-ralph

An [OpenCode](https://opencode.ai) agent that works autonomously until the task is done.

## What it does

Ralph is a custom OpenCode agent that solves the "stops after each step" problem. It:

- **Loops autonomously** -- re-invokes the agent until it signals completion with `<ralph>DONE</ralph>`
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

The `ralph.md` agent definition is bundled. Place it next to the binary or in your working directory -- the tool finds it automatically.

## Usage

### Interactive TUI (no arguments)

```bash
ralph
```

Opens the interactive menu where you can:

- **New session** -- pick a model (fuzzy search), choose a thinking variant, set max iterations, enter your prompt
- **Recent sessions** -- browse past sessions, view logs, resume incomplete sessions
- **Settings** -- set default model, thinking variant, and max iterations
- **Refresh models** -- force-refresh the model cache from OpenCode

### CLI mode (with a prompt)

```bash
ralph "Fix all failing tests"

ralph -m openrouter/anthropic/claude-opus-4.6 "Refactor the auth module"

ralph --thinking high "Solve this complex bug"

ralph --max-iter 5 "Add input validation to the API"

ralph --once "Explain the auth flow"

ralph --resume abc123_x7k "Keep going for 10 more iterations"

ralph --resume abc123_x7k --max-iter 20 "Continue with higher limit"
```

### Flags

| Flag | Default | Description |
|------|---------|-------------|
| `-m, --model` | saved default or interactive | Model to use (provider/model-id) |
| `--thinking` | `off` | Thinking variant name (e.g. `low`, `high`, `max`) |
| `--max-iter` | `50` (or `$RALPH_MAX_ITER`) | Maximum loop iterations |
| `--once` | off | Run once without looping |
| `--resume <id>` | off | Resume an incomplete session for additional iterations |
| `--no-status` | off | Disable the floating status bar |
| `--refresh` | off | Force-refresh the model cache |
| `--tui` | auto | Open the interactive TUI |
| `-h, --help` | | Show help |

### Environment variables

| Variable | Description |
|----------|-------------|
| `RALPH_MODEL` | Default model (overridden by `-m`) |
| `RALPH_MAX_ITER` | Default max iterations (overridden by `--max-iter`) |
| `RALPH_HOME` | Data directory (default: `~/.ralph`) |

### Config precedence

Settings are resolved highest-wins: **CLI flags > env vars > saved config file > defaults**.

## How the loop works

Each `opencode run` invocation is a fresh subprocess -- Ralph has no access to OpenCode's internal conversation history. Ralph handles persistence across iterations:

1. **Iteration 1** (new session): Sends your original prompt to the agent
2. **Iteration 2+**: Sends a continuation prompt: "Continue working on the following task. Check the current state of the codebase and pick up where you left off: \<original prompt\>"
3. **After each iteration**: Checks the agent's output for `<ralph>DONE</ralph>`
4. **If found**: Marks the session as complete and exits successfully
5. **If not found**: Starts the next iteration (up to `--max-iter`)

If `opencode` exits with a non-zero code, the session stops immediately with an error.

### Resuming sessions

If a session hit its iteration limit without completing, you can resume it:

- **TUI**: Select the session in the session browser and choose "Resume". You'll be prompted for how many additional iterations to run.
- **CLI**: Use `--resume <session-id>`. The `--max-iter` flag controls how many *additional* iterations to run (default: 50).

When resuming, every iteration uses the continuation prompt (never the raw prompt), and the existing session's metadata and log file are updated in-place -- no new session is created. The iteration counter continues from where it left off.

## Model discovery

Ralph uses the [OpenCode SDK](https://www.npmjs.com/package/@opencode-ai/sdk) to dynamically discover all models from your connected providers. Nothing is hardcoded -- model lists, thinking variants, and provider configs all come from OpenCode at runtime.

Models are cached to `$RALPH_HOME/models.cache.json` with a 1-hour TTL for fast startup. Use `--refresh` or the "Refresh models" menu option to update.

## Thinking variants

Thinking/reasoning levels are discovered per-model from OpenCode's variant system. Different providers expose different variants:

| Provider | Example variants |
|----------|-----------------|
| OpenRouter | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| Anthropic | `low`, `high`, `max` |
| GitHub Copilot | `low`, `medium`, `high` |
| Google | `high`, `max` |

The variant config objects are passed through directly to the AI SDK -- no translation layer.

## Permissions

By default Ralph has full autonomy:

| Tool | Permission |
|------|-----------|
| `edit` | `allow` -- no prompts on file changes |
| `bash` | `allow` -- runs shell commands without prompts |
| `webfetch` | `allow` -- fetches URLs without prompts |

To customize, edit `ralph.md` and adjust the `permission` block. Changes to `ralph.md` are honoured even when thinking variants are active -- the full frontmatter is read and the variant config is merged in. See the [OpenCode permissions docs](https://opencode.ai/docs/permissions/).

## Configuration

Settings are saved to `$RALPH_HOME/config`. Session metadata is stored as JSON in `$RALPH_HOME/sessions/`.

| Setting | Value | Why |
|---------|-------|-----|
| `mode` | `primary` | Tab-switchable in TUI |
| `temperature` | `0.7` | Balanced creativity |
| `edit: allow` | No approval pauses | Core fix for the "stops each step" problem |

## Development

```bash
bun install          # install deps
bun run dev          # run from source
bun run check        # type-check
bun test             # run tests
bun run build        # compile binary to bin/ralph
```

## Project structure

```
src/
  index.ts           # CLI parsing + TUI/CLI mode router
  types.ts           # Shared types (ModelInfo, Config, SessionMeta)
  core/
    agent.ts         # Agent .md file generation with variant config
    config.ts        # Config load/save ($RALPH_HOME/config)
    models.ts        # SDK model discovery + caching + fuzzy search
    opencode.ts      # Binary lookup + dev-server lifecycle
    runner.ts        # opencode run subprocess loop
    sessions.ts      # Session metadata storage (JSON)
  tui/
    helpers.ts       # Shared TUI components (model picker, callbacks)
    menu.ts          # Main menu loop
    new-session.ts   # New session flow (model -> thinking -> prompt)
    sessions.ts      # Session browser
    settings.ts      # Settings editor
    status-bar.ts    # Floating footer (iteration, elapsed time, model, thinking)
    theme.ts         # Styling helpers
  __tests__/         # Unit tests
ralph.md             # Agent definition file
```
