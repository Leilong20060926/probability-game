// 後端唯一 import frontend/src/engine.js 的地方。
//
// 後端把這份引擎當成遊戲規則的單一來源（已 12/12 測試，見 tests/engine.test.js），
// 不另外複製一份規則實作，避免 docs/RULES.md 提醒的「不同版本不可混用」問題。
// 這是跨越 Codex 擁有區（frontend/）的唯讀相依：只 import，絕不修改該檔案。
// 往後若 Codex 變更 frontend/src/engine.js 的規則，等於同時變更後端規則，
// 需要雙方 review（見 docs/HANDOFF.md）。
export {
  VERSION,
  CONFIG,
  CARDS,
  card,
  key,
  newGame,
  canPlace,
  reachable,
  act,
  checkTimeout,
  abandon,
  recordLifecycle,
} from '../../frontend/src/engine.js';
