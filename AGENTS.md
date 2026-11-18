# Collaboration

This repository is a Traditional Chinese classroom probability game. Read `docs/RULES.md`, `docs/API.md`, and `docs/HANDOFF.md` before changing behavior.

- Codex owns `frontend/`, frontend tests, and review. Claude Code owns backend implementation and backend tests. Coordinate shared changes in `docs/HANDOFF.md`.
- Do not overwrite another collaborator's changes. Inspect Git status before editing. Work on separate branches/worktrees if sharing GitHub rather than one filesystem.
- User has approved starting implementation. No questionnaire for now. Players see only their own current result. Aggregate data and CSV no longer require server-side team authorization (user decision, 2026-11-14): the 紀錄與統計 admin endpoints (`/api/admin/games`, `/stats`, `/export.csv`, `/events.csv`) are publicly readable without login. See `docs/API.md` and `docs/HANDOFF.md` for details.
- User explicitly approved public per-game deletion on 2026-11-18: anyone may call `DELETE /api/admin/games/:id`. The UI confirms permanent removal of that game and events. Do not reintroduce a login gate for this operation. Codex was authorized to implement this backend addition; the usual backend ownership remains Claude Code.
- Backend is implemented (Node built-ins and SQLite); see the latest `docs/API.md` contract. The default frontend is route-v1, with an explicit memory-only trial option and a server-recorded option. Never claim memory/localStorage data has been uploaded or backed up.
- Do not deploy a public research collection service until end-to-end storage, player isolation, export and browser flows are verified. Public aggregate reads remain intentional; do not reintroduce admin login requirements.
- `npm test` runs frontend and legacy engine tests (including HTTP integration); `npm run test:backend` and `npm run test:route` cover the backend and shared route core. `npm run build` packages the frontend and four shared modules. No runtime npm dependencies.
