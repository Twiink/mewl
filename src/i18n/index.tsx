import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type TranslationKey } from "./en";
import { zh } from "./zh";
import type { Locale } from "./types";

// Storage key for the locale preference. It is deliberately separate from the
// workspace persistence key so restoring or resetting a workspace never
// overwrites the user's language choice.
// 语言偏好的存储键。刻意与工作区持久化键分开，确保恢复或重置工作区时
// 永远不会覆盖用户的语言选择。
const localeStorageKey = "mewl.locale";

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  zh,
};

export type TranslationParams = Record<string, string | number>;

// Resolve {name} placeholders and the plural markers {|a,b} / {key|a,b}.
// The anonymous marker reads params.count; the named one reads its own param.
// A single form is a bare plural suffix; two forms are singular/plural.
// 解析 {name} 占位符与复数标记 {|a,b} / {key|a,b}。
// 匿名标记读取 params.count；命名标记读取自身指定的参数。
// 单一形式表示纯复数后缀；两种形式依次为单数/复数。
function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template;
  }

  return template.replace(
    /\{(\w+)?\|([^}]*)\}|\{(\w+)\}/g,
    (_match, countKey: string | undefined, forms: string | undefined, key?: string) => {
      if (forms !== undefined) {
        const [first, second] = forms.split(",");
        const isSingular = Number(countKey ? params[countKey] : params.count) === 1;

        if (second === undefined) {
          return isSingular ? "" : first;
        }

        return isSingular ? first : second;
      }

      const value = key === undefined ? undefined : params[key];
      return value === undefined ? `{${key}}` : String(value);
    },
  );
}

function readInitialLocale(): Locale {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(localeStorageKey);
    if (stored === "en" || stored === "zh") {
      return stored;
    }
  }

  // First run: follow the browser UI language, then fall back to English.
  // 首次运行：跟随浏览器界面语言，无法识别时回退到英文。
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) {
    return "zh";
  }

  return "en";
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) =>
      interpolate(dictionaries[locale][key] ?? en[key], params),
    [locale],
  );

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";

      // index.html ships an English meta description for crawlers and browser
      // previews; keep it in the active language for the running session.
      // index.html 自带的 meta description 服务于爬虫与浏览器预览；
      // 运行期间让它跟随当前语言。
      const metaDescription = document.querySelector<HTMLMetaElement>(
        'meta[name="description"]',
      );
      if (metaDescription) {
        metaDescription.setAttribute("content", t("app.metaDescription"));
      }
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(localeStorageKey, locale);
    }

    // Keep the Electron main process in sync so bridge-generated alerts, logs,
    // and action messages are produced in the active language.
    // 与 Electron 主进程保持同步，使桥接生成的告警、日志与操作消息
    // 跟随当前语言输出。
    void window.mewlHost?.setLocale?.(locale)?.catch(() => {
      // Bridge calls are best-effort; the web shell has no host bridge.
      // 桥接调用尽力而为；纯浏览器外壳没有宿主桥接。
    });
  }, [locale, t]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used inside LocaleProvider");
  }

  return context;
}

export type { Locale, TranslationKey };
