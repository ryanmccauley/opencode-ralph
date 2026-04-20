# opencode-ralph

Ralph as a native OpenCode agent plus plugin loop.

## What it is

This package turns Ralph into an OpenCode plugin instead of a standalone TUI.

It keeps the OpenCode experience intact:

- use `@file` mentions in normal prompts
- use `Esc` to stop the current run
- stay in the same OpenCode session
- use OpenCode's native model picker, history, undo, redo, and sharing

The plugin adds Ralph's outer loop on top of a normal OpenCode `ralph` agent.

## Current status

This branch is the first plugin-first implementation. It includes:

- native `ralph` agent config injection
- same-session automatic continuation loop
- persistent Ralph session state in `.opencode/ralph-state.json`
- `ralph_complete` tool for explicit completion
- `ralph_wait` tool for intentional pauses
- control commands:
  - `/ralph-limit`
  - `/ralph-pause`
  - `/ralph-resume`
  - `/ralph-status`

## Install for local development

Add the plugin to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-ralph"]
}
```

Then build it:

```bash
bun install
bun run build
```

OpenCode will load the plugin package and inject the `ralph` agent automatically.

## Usage

1. Switch to the `ralph` agent.
2. Optionally set a limit:

```text
/ralph-limit 20
```

3. Send a normal prompt:

```text
Fix @src/api/auth.ts and make the failing auth tests pass.
```

If the agent does not signal completion, Ralph continues in the same session automatically.

## Commands

### `/ralph-limit <n>`

Set the Ralph iteration budget for the current session.

### `/ralph-pause`

Pause the current Ralph run.

### `/ralph-resume [n]`

Resume the paused Ralph run. If `n` is supplied, Ralph uses that iteration limit.

### `/ralph-status`

Show the current Ralph run status.

## Completion behavior

Ralph should call `ralph_complete` when the task is fully complete and verified.

For migration safety, the plugin also still recognizes `<ralph>DONE</ralph>` if it appears in assistant output.

## Stop behavior

The intended behavior is:

- `Esc` aborts the current OpenCode turn
- Ralph treats that as a pause
- Ralph does not auto-resume until you explicitly resume it

This implementation listens for `MessageAbortedError` to detect user aborts.

## State

Ralph stores session loop state in:

```text
.opencode/ralph-state.json
```

This stores only lightweight loop metadata, not full transcripts.

## Development

```bash
bun install
bun run check
bun test
bun run build
```

## Notes

- The public OpenCode plugin API does not expose custom native TUI panels, so Ralph uses the normal OpenCode UI.
- The plugin uses `promptAsync()` continuations in the same session.
- Continuation prompts are marked synthetic so the UX stays as close to stock OpenCode as possible.
