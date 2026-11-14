// 統一錯誤格式：{ error: { code, message } }，不帶內部資料。
// 代碼表見 docs/API.md「錯誤格式」。
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message },
      ...this.extra,
    };
  }
}

export const errors = {
  unauthorized: (message = '未登入或憑證已過期') =>
    new ApiError(401, 'UNAUTHORIZED', message),

  notFound: (message = '找不到資源') =>
    new ApiError(404, 'NOT_FOUND', message),

  invalidAction: (message = '無效的行動') =>
    new ApiError(422, 'INVALID_ACTION', message),

  // game：目前安全 GameView，依 docs/API.md 定案，body 須附最新狀態供前端直接恢復。
  gameInProgress: (game, message = '已有進行中的遊戲') =>
    new ApiError(409, 'GAME_IN_PROGRESS', message, { game }),

  revisionConflict: (message = 'revision 與伺服器不一致') =>
    new ApiError(409, 'REVISION_CONFLICT', message),

  idempotencyKeyReuse: (message = '同一 key 使用了不同的請求內容') =>
    new ApiError(409, 'IDEMPOTENCY_KEY_REUSE', message),

  rateLimited: (message = '嘗試次數過多，請稍後再試') =>
    new ApiError(429, 'RATE_LIMITED', message),

  badRequest: (message = '請求格式錯誤') =>
    new ApiError(400, 'BAD_REQUEST', message),

  forbidden: (message = '沒有權限') =>
    new ApiError(403, 'FORBIDDEN', message),
};
