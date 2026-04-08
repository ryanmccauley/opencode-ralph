# opencode-ralph

An [OpenCode](https://opencode.ai) agent that works autonomously until the task is done, narrated in Ralph Wiggum's voice.

"I'm helping!"

## What it does

Ralph is a custom OpenCode agent that solves the "stops after each step" problem. It:

- **Loops autonomously** -- the wrapper script re-invokes the agent until it signals completion with `<ralph>DONE</ralph>`
- **Keeps going** until the task is complete instead of pausing for confirmation
- **Runs tests, fixes errors, re-runs** in a loop without asking "should I continue?"
- **Narrates everything** in Ralph Wiggum's voice
- **Writes correct code** despite the personality

## Install

Copy the agent file into your OpenCode agents directory:

```bash
# Global (available in all projects)
cp ralph.md ~/.config/opencode/agents/ralph.md

# Or per-project
mkdir -p .opencode/agents
cp ralph.md .opencode/agents/ralph.md
```

### Optional: install the wrapper script

```bash
# Add to your PATH
cp ralph /usr/local/bin/ralph

# Or symlink it
ln -s "$(pwd)/ralph" /usr/local/bin/ralph
```

## Usage

### From the TUI

1. Launch `opencode`
2. Press **Tab** to cycle agents until you see `ralph`
3. Type your task and let it run

### From the CLI

```bash
opencode run --agent ralph --model anthropic/claude-sonnet-4-20250514 "Fix all failing tests"
```

### With the wrapper script

The wrapper script loops automatically, re-invoking the agent until it outputs the completion token or hits the iteration limit.

```bash
ralph -m anthropic/claude-sonnet-4-20250514 "Fix all failing tests"

# Or set a default model
export RALPH_MODEL="anthropic/claude-sonnet-4-20250514"
ralph "Refactor the auth module"

# Limit iterations
ralph --max-iter 5 "Add input validation to the API"

# Single run, no loop (like the old behavior)
ralph --once "Explain the auth flow"
```

| Flag | Default | Description |
|------|---------|-------------|
| `-m, --model` | `$RALPH_MODEL` | Model to use (provider/model-id) |
| `--max-iter` | `50` (or `$RALPH_MAX_ITER`) | Maximum loop iterations before giving up |
| `--once` | off | Run once without looping (single invocation) |

To see available models:

```bash
opencode models
opencode models anthropic   # filter by provider
```

## How the loop works

Each `opencode run` invocation is a fresh session. The `ralph` wrapper script handles persistence across sessions:

1. **Iteration 1**: Sends your original prompt to the agent
2. **Iteration 2+**: Sends `"Continue working on the following task. Check the current state of the codebase and pick up where you left off: <original prompt>"`
3. **After each iteration**: Checks the agent's output for `<ralph>DONE</ralph>`
4. **If found**: Exits successfully
5. **If not found**: Starts the next iteration (up to `--max-iter`)

The completion token is defined in both `ralph.md` (so the agent knows to output it) and the wrapper script (so the script knows to look for it).

## Permissions

By default Ralph has:

| Tool | Permission |
|------|-----------|
| `edit` | `allow` -- no prompts, so it doesn't stop on every file change |
| `bash` | `allow` -- runs shell commands without prompts for full autonomy |
| `webfetch` | `allow` -- fetches URLs without prompts |

To customize, edit `ralph.md` and adjust the `permission` block. See the [OpenCode permissions docs](https://opencode.ai/docs/permissions/) for the full syntax. For example, to require approval for specific commands:

```yaml
permission:
  bash:
    "*": allow
    "rm -rf*": ask
    "git push*": ask
```

## Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `mode` | `primary` | Tab-switchable in TUI |
| `temperature` | `0.7` | More creative Ralph-like narration |
| `color` | `#FF073A` | Neon red, like Ralph's firetruck dreams |
| `edit: allow` | No approval pauses | Core fix for the "stops each step" problem |

## License

MIT
