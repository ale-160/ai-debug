# 蛛网 · AI Debug

[中文](./README.md) | English

> Turn AI conversations from a linear list into a git-repository-style spider web.

[![Deploy](https://img.shields.io/badge/Next.js-16.2.6-black)](https://nextjs.org)
[![Stack](https://img.shields.io/badge/React-18-blue)](https://react.dev)
[![Canvas](https://img.shields.io/badge/React%20Flow-11-orange)](https://reactflow.dev)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**Live Demo**: <https://ai-debug.ale160.com>

## What is this

A **spider-web-style AI conversation context manager**.

Every LLM product today is linear: chat history is a tape you can only "play" or "clear". When a problem gets complex (e.g. debugging), history piles up, the model has to sift through irrelevant noise, and accuracy inevitably drops.

`蛛网` organizes the conversation into an interactive topological graph: each branch maintains its own context path, and you can backtrack, fork, merge, abandon, or restore at any time. **At inference time, only the "clean context" along the current path is fed to the model**, so every new question inherits only the prerequisites it truly needs.

This isn't a "better chat UI" — it turns the LLM context window from a black box into a user-operable workspace.

## Core idea: a Git repo for conversations

| Git concept | 蛛 web equivalent | User value |
| --- | --- | --- |
| `branch` | Fork a new sub-line from any node | Explore directions without cross-interference |
| `commit` | Each TurnNode = one conversational turn | Every interaction is fully recorded |
| `log` | Root → current node context path | Each line's lineage is clearly visible |
| `checkout` | Click any node to view/continue in the right panel | Jump back to any "commit" and keep working |
| `revert` / `reset` | Mark a branch as `abandoned` | Drop a wrong direction but keep the record |
| `merge` | Combine multiple branches into a new node | Aggregate conclusions from different lines |
| `diff` | Conflict detection | Detect contradictions along a single path |

## Core features

### Spider-web canvas
- Radial layout auto-arranges nodes so branches stay legible
- Select mode / hand mode (`V` / `H` to toggle, `Space` for temporary hand)
- Shortcuts: `F` fit-view, `Delete` remove selected; canvas shortcuts disabled inside input fields
- Auto-save: nodes/edges debounced 500ms, viewport debounced 800ms
- Draft state isn't saved; auto-save activates once the first message binds a project

### Nodes & branches
- **Suggestion cards**: AI proposes next-step directions after each answer; clicking doesn't fire immediately — it fills the input box, and the user triggers via "Continue asking"
- **Continue asking**: follow up under the current node, creating a new child
- **Regenerate**: if the answer is unsatisfying, supplement your prompt and regenerate (auto-cancels the previous streaming request to avoid interleaving old/new content)
- **Fork branch**: start a new sub-line from any node to switch direction
- **Merge branches**: select multiple nodes and merge into a new node with multi-path context (known limit: conflict detection only analyzes the trunk path)
- **Abandon / Restore**: mark a branch `abandoned` — visually dimmed but preserved; restore anytime
- **Ignore node**: skip a node when building context while its children still run

### Context path
- `collectContextPath`: walks the `parentId` chain from root to the current node to gather full context
- Only the current path is injected at inference time — other branches never pollute it
- Supports multi-path context for merged nodes (`mergedFromIds`)

### Memory & rules (Beta)
- **Global rules**: user-editable meta-prompt fragments injected into every system prompt
- **Global memory**: long-term memory entries shared across projects
- **Project memory**: memory entries scoped to a single project
- **Frequency-based auto-extraction**: every N turns (configurable), auto-extract memory entries from the conversation
- **Conflict auto-detection**: every N turns, auto-detect contradictions along the current line
- Memory is off by default; enable it in Settings

### AI web pruner
- When node count ≥ 10, an "AI prune web" button appears in the sidebar
- AI analyzes the entire web, spotting duplicate / dead-end lines
- **Never deletes the original project** — instead it derives a streamlined new project (`projectType: derived-pruned`) and keeps an `originalProjectId` link
- A clean recreation of Git's "working tree / history" separation: pruning becomes forking, deletion becomes archiving

### Dual display modes
- Detailed mode: full Markdown rendering + suggestion cards
- Compact mode: minimal nodes for browsing large canvases

## Tech stack

- **Frontend**: Next.js 16 (Turbopack) + React 18 + TypeScript 5
- **Canvas**: React Flow 11 (radial layout + DAG nodes)
- **State**: Zustand 5 (single source of truth, avoids direct localStorage reads)
- **Styling**: Tailwind CSS 3 + dark mode
- **Storage**: browser localStorage (no backend, works out of the box)
- **Streaming**: OpenAI-compatible SSE with AbortController cancellation

## Project structure

```
ai-debug/
├── apps/
│   └── web/                         # Next.js app
│       └── src/
│           ├── app/                 # App Router entry
│           ├── components/
│           │   ├── node-flow/       # Spider-web canvas core
│           │   │   ├── DebugFlowEditor.tsx   # Top container + TopNav + EmptyStateInput
│           │   │   ├── NodeCanvas.tsx        # Canvas + auto-save + merge branches
│           │   │   ├── NodeInspector.tsx     # Right-side node detail panel
│           │   │   ├── NodeSidebar.tsx       # Left project list + 3-dot menu + import
│           │   │   ├── nodes/TurnNode.tsx   # Single-node renderer
│           │   │   ├── radial-layout.ts     # Radial layout algorithm
│           │   │   └── types.ts             # TurnNode / NetworkProject types
│           │   ├── SettingsModal.tsx # Settings modal (API / Memory & Rules)
│           │   └── MemoryPanel.tsx   # Memory management panel
│           └── lib/
│               ├── debug-store.ts       # Zustand store (nodes / projects / settings)
│               ├── network-engine.ts    # Streaming calls + context-path collection
│               ├── llm-client.ts        # OpenAI-compatible client
│               ├── llm-config.ts        # Provider presets (mimo / Volcengine / DeepSeek…)
│               ├── llm-helpers.ts        # Summary generation + suggestion parsing
│               ├── memory-engine.ts      # Memory extraction + context building
│               ├── conflict-engine.ts    # Branch conflict detection
│               ├── network-pruner.ts     # AI web-prune derive logic
│               ├── project-storage.ts    # Project localStorage persistence
│               └── settings-storage.ts   # Global settings / memory persistence
└── package.json                      # pnpm workspace root
```

## Quick start

### Requirements
- Node.js ≥ 22
- pnpm ≥ 9

### Install & run

```bash
# From the repo root
pnpm install

# Start the dev server (you must cd into apps/web; root is only the workspace entry)
cd apps/web
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> ⚠️ Root-level `pnpm dev` forwards to `apps/web` via `pnpm --filter @ai-debug/web dev`. If the port is taken, use `taskkill /PID <pid> /F` (Windows) or `kill <pid>` (Unix) to free it, or just `cd apps/web && pnpm dev`.

### Configure API Key

On first launch you'll be prompted to configure. Click "Unconfigured" or the Settings button at the top right and pick a provider:

| Provider | Default model | How to get |
| --- | --- | --- |
| Xiaomi MiMo | mimo-v2.5 | [platform.xiaomimimo.com](https://platform.xiaomimimo.com?ref=HVJJGY) (referral code, ¥10 credit) |
| Volcengine Ark | doubao-seed-2.0 | [volcengine.com](https://volcengine.com/L/uH3ewWuCZDw/) (code K42LBHZY, 5% off stacking) |
| OpenRouter | nvidia/nemotron-3-ultra-550b-a55b:free | [openrouter.ai/keys](https://openrouter.ai/keys) |
| DeepSeek | deepseek-v4-flash | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| OpenAI | gpt-4o-mini | [platform.openai.com](https://platform.openai.com/api-keys) |
| Custom | — | Any OpenAI-compatible endpoint |

API Keys are stored only in the browser's `localStorage` and never touch any server.

## Workflow

1. **New project**: sidebar "New project" → draft canvas → type the first question → project auto-binds
2. **Follow up / fork**: click a node → right panel → input box or suggestion card → "Continue asking"
3. **Abandon a line**: select a node → "Abandon this branch" → visually dimmed but preserved
4. **Merge branches**: Shift-click to select multiple nodes → "Merge branches" → type intent → AI synthesizes multi-path context
5. **Prune the web**: when nodes ≥ 10 the sidebar shows "AI prune web" → derives a streamlined new project

## Deployment

Pure static frontend — deploy to any platform that supports Next.js:

```bash
cd apps/web
pnpm build
```

Recommended: [Cloudflare Pages](https://pages.cloudflare.com) or [Vercel](https://vercel.com).

## Known limits

- **Conflict detection doesn't expand merged multi-paths**: for a merged node, detection only analyzes the `parentId` trunk, not `mergedFromIds` branches (UI shows a hint)
- **Streaming summary may be lost**: summary generation runs as a sidecar; if the user switches projects before it completes, the summary is dropped (accepted tradeoff by design)
- **localStorage capacity**: all data lives in the browser; very large single projects may hit quota

## Privacy statement

This project takes your privacy seriously — all data is stored locally in your browser.

### Data storage

- **All data is stored in browser localStorage**: projects, nodes, memory, and settings stay on your device and are never uploaded to any server
- **API Keys are local-only**: the LLM provider API Key you configure is kept solely in browser localStorage and never passes through any backend of this project (there is no backend)
- **You're in control**: you can review storage usage, clean up by category, or wipe everything at any time in "Settings → Data Management"

### Data flow

- **Your conversation input** is sent directly to your configured LLM provider (e.g. Xiaomi MiMo, Volcengine Ark, DeepSeek) to generate AI responses
- **Streaming requests** go from the browser straight to the provider's API — no intermediate proxy
- **Neither this GitHub repo nor the deployment site** collects, stores, or analyzes your conversations

### Third-party services

- The LLM provider you select receives your conversation content for inference; its data handling is governed by that provider's privacy policy
- The hosting platform (e.g. Cloudflare Pages) only serves static assets and does not perform dynamic data collection

For privacy questions, contact: [ale160@126.com](mailto:ale160@126.com)

## Design philosophy

This project doesn't fix LLM hallucinations — it tackles **context chaos**.

When a user faces a complex problem, traditional linear chat forces the model to dig through irrelevant historical noise. The spider web lets every new question inherit only "the prerequisites it must know", reclaiming wasted context window for the core reasoning.

This isn't chat — it's precise scheduling of LLM compute.

## License

MIT

> **PS**: This project is open-sourced under MIT with no hard constraints. If you build on or deploy this project, please consider keeping the source (repo link <https://github.com/ale-160/ai-debug> and author attribution `ale-160`), so more people can discover how far the "spider-web conversation" idea can travel. Honor among peers — thanks for understanding.

## Contact

For questions, suggestions, or feedback, reach out via:

- 📧 Email: [ale160@126.com](mailto:ale160@126.com)

---

## Support & Sponsorship 💖

To support the ongoing development of this project, please visit the unified sponsorship page:

👉 `https://ale160.com/sponsor`


---

## Contributing

Contributions are welcome! Feel free to open a Pull Request.
