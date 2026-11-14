# Collaboration

This repository is a Traditional Chinese classroom probability game. Read `docs/RULES.md`, `docs/API.md`, and `docs/HANDOFF.md` before changing behavior.

- Codex owns `frontend/`, frontend tests, and review. Claude Code owns backend implementation and backend tests. Coordinate shared changes in `docs/HANDOFF.md`.
- Do not overwrite another collaborator's changes. Inspect Git status before editing. Work on separate branches/worktrees if sharing GitHub rather than one filesystem.
- User has approved starting implementation. No questionnaire for now. Players see only their own current result. Aggregate data and CSV require server-side team authorization.
- Backend is not implemented yet. Frontend currently uses local browser storage, visibly labeled. Never claim local data has been uploaded.
- Proposed API is a contract for discussion with Claude Code, not an existing backend. Do not deploy a public research collection service until end-to-end storage, authorization and export are verified.
- `npm test` runs engine tests; `npm run build` packages static frontend. No runtime npm dependencies.