// Error type for failures that carry a translation key instead of display text.
// The renderer resolves messageKey through t() at render time so a locale switch
// also re-renders the error copy. Raw Error messages (already localized by the
// Electron main process) still flow through the normal path.
// 携带翻译键而非展示文本的错误类型。渲染层在渲染时通过 t() 解析 messageKey，
// 因此切换语言后错误文案也会随之刷新。原始 Error（由 Electron 主进程本地化后的
// 消息）仍走常规展示路径。
import type { TranslationKey } from "./en";

export class MewlLocalizedError extends Error {
  readonly messageKey: TranslationKey;

  constructor(messageKey: TranslationKey) {
    super(messageKey);
    this.name = "MewlLocalizedError";
    this.messageKey = messageKey;
  }
}
