# opencode-ralph

An [OpenCode](https://opencode.ai) agent that works autonomously until the task is done, narrated in Ralph Wiggum's voice.

"I'm helping!"

## What it does

Ralph is a custom OpenCode agent that solves the "stops after each step" problem. It:

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

```bash
ralph -m anthropic/claude-sonnet-4-20250514 "Fix all failing tests"

# Or set a default model
export RALPH_MODEL="anthropic/claude-sonnet-4-20250514"
ralph "Refactor the auth module"
```

To see available models:

```bash
opencode models
opencode models anthropic   # filter by provider
```

## Permissions

By default Ralph has:

| Tool | Permission |
|------|-----------|
| `edit` | `allow` -- no prompts, so it doesn't stop on every file change |
| `bash` | `ask` -- prompts before running shell commands |
| `webfetch` | `ask` -- prompts before fetching URLs |

To customize, edit `ralph.md` and adjust the `permission` block. See the [OpenCode permissions docs](https://opencode.ai/docs/permissions/) for the full syntax, including granular bash patterns like:

```yaml
permission:
  bash:
    "*": ask
    "npm test*": allow
    "git status*": allow
```

## Configuration

| Setting | Value | Why |
|---------|-------|-----|
| `mode` | `primary` | Tab-switchable in TUI |
| `temperature` | `0.7` | More creative Ralph-like narration |
| `color` | `#FFD700` | Gold, like Ralph's... personality |
| `edit: allow` | No approval pauses | Core fix for the "stops each step" problem |

## License

MIT
