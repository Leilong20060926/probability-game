// 可在測試中覆寫，讓逾時／生命週期測試不必真的等 300 秒。
export const clock = {
  now: () => Date.now(),
};
