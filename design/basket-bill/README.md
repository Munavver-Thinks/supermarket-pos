# Basket Bill design: hand-off for Claude Code

This folder is the design for restyling **Supermarket POS** (`apps/pos-desktop`). It is reference material only; nothing in the app imports from here.

## Links

- **Design system (live, on claude.ai):** https://claude.ai/code/artifact/1d332eb7-2985-417a-ba59-ce84751ca220
  Private to the owner's Claude account. Open it while signed in, or share it from its Share menu before giving it to someone else.
- **Wireframes, offline:** open `wireframes/index.html` in a browser (or VS Code's Live Preview). Use the Theme menu at the top to switch all 43 wireframes between the five themes. Any single wireframe also takes `?theme=vivid-night` and similar in its address.

## What's here

| File | What it is |
| --- | --- |
| `HANDOFF.md` | The implementation plan for Claude Code: what to change, in which files, in what order, and how to check it. |
| `PROMPT.md` | A prompt to paste into Claude Code in VS Code to start the work. |
| `tokens.json` | Every design token: colours for 5 themes, type styles, spacing, radius, sizes, shadow. The source of truth. |
| `tokens.css` | The same tokens as CSS custom properties: `:root` is Calm Day; `[data-theme="dark" \| "contrast" \| "vivid" \| "vivid-night"]` override colours. |
| `components.css` | The design system's component styles (`bb-*`) and the wireframe app shell (`pos-*`). For reference; port the parts you need into `styles.css`. |
| `wireframes/` | 20 screens (`S01`–`S20`) and 23 popups (`P01`–`P23`), each a standalone HTML file using the app's real labels and F-keys. An HTML comment at the top of each file explains it. |

## Themes

| id | Name | Set |
| --- | --- | --- |
| `light` | Day counter | Calm, day |
| `dark` | Night shift | Calm, night |
| `vivid` | Vivid Day | Vivid, day |
| `vivid-night` | Vivid Night | Vivid, night |
| `contrast` | High contrast | Accessibility override |

Every text colour pair passes WCAG 4.5:1 in every theme (High contrast passes 7:1).
