# Claude History Manager

A local web app for browsing and managing your Claude Code chat history, plugins, skills and `CLAUDE.md` files.

It only listens on `127.0.0.1` and reads straight from `~/.claude`. Nothing leaves your machine unless you click **AI summary** (see below).

## Run

```bash
bun install
bun start          # → http://localhost:4545
```

Use `PORT=5000 bun start` to change the port, `CLAUDE_CONFIG_DIR=/path` to point it at a different Claude folder, and `CLAUDE_BIN=/path/to/claude` if `claude` isn't on your `PATH`.

## What it does

**Chats** (per project, from `~/.claude/projects/<project>/*.jsonl`)
- List and search every chat. Shows the title, date and size.
- Read a transcript. Tool calls and results are hidden by default; turn them on with "Show tools".
- Rename a chat. This uses the same record as Claude Code's `/rename`, so `claude --resume` shows the new name too.
- Export a chat to Markdown, or copy its `claude --resume <id>` command.
- Delete a chat, or **delete all chats in a project** at once. Everything goes to **Trash** first. Chats used in the last 2 minutes are skipped, because they may still be open.
- In Trash, restore one chat or a whole project, delete one for good, or empty the trash.
- **Summary** for every chat: goal, outcome, prompt/tool counts, duration and files changed. It's built locally and instantly.
- **AI summary** (opt-in, per click): up to 5 short bullets written by Claude Haiku through your own `claude` CLI. It runs with no tools and no session persistence, so it can't change anything or add a chat to your history. The chat text is sent to Anthropic the same way Claude Code sends it. Results are cached in `data/summaries/`.

**Plugins** (through the `claude plugin` CLI, so it behaves exactly like the terminal)
- See every installed plugin with its version, description and skill/agent/command/MCP counts.
- Enable, disable, update or uninstall user-scope plugins. Synced and project plugins are shown read-only.
- **Discover**: search every plugin in your marketplaces, sorted by installs, and install with one click.
- **Add from URL**: add a marketplace from `owner/repo`, an `https://` URL or a `git@` URL. Its plugins then appear under Discover. Local paths are refused.
- Restart Claude Code after changes for them to take effect.

**Skills**
- Lists personal skills (`~/.claude/skills`) and every skill shipped by installed plugins.
- Create, edit (with backup) and delete personal skills. Deleting moves the folder to `data/backups/skills/`. For a symlinked skill, only the link is moved.
- Plugin skills are read-only.

**Look and feel**
- Overview dashboard, light, dark and system themes (remembered per browser), and subtle animations that switch off with "reduce motion".

**CLAUDE.md and memory**
- Personal: `~/.claude/CLAUDE.md` and everything under `~/.claude/rules/`.
- Per project: `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, and auto memory (`~/.claude/projects/<project>/memory/*.md`).
- View, edit (save with ⌘S), create and delete these files. Every save and delete keeps a copy of the previous version in `data/backups/`.

## Where things are stored

| What | Where |
| --- | --- |
| Trash | `data/trash/<project>/<session>/` |
| Backups of edited docs and skills | `data/backups/` |
| AI summaries | `data/summaries/<project>/<session>.json` |

`data/` is git-ignored.

## Safety

- The server listens on localhost only and rejects requests with a foreign `Host` header, which blocks DNS-rebinding attacks.
- Any request that changes something must send the `x-chm-request` header, so other websites can't trigger actions.
- It can only edit a fixed set of document paths. Project and session ids are checked against strict patterns.
- Transcripts and AI output are shown as plain text, never as HTML. A strict Content-Security-Policy allows scripts only from the app itself.
- The `claude` CLI is always started with an argument list, never through a shell. Plugin ids, marketplace names and sources are pattern-checked first, so they can't be read as flags.

## Develop

```bash
bun run dev        # restarts on file changes
bun test           # unit tests (use a temporary sandbox, never your real ~/.claude)
bun run type-check
```

## Credits

© 2026 Sulash Manandhar. Developed with the help of [Claude Code](https://claude.com/claude-code).

This is an independent, unofficial tool. It is not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic, used here only to describe what the tool works with.
