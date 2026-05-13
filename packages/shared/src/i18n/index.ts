import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

export const defaultNS = 'translation';

export const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
} as const;

export type SupportedLocale = keyof typeof resources;

export const supportedLocales: { key: SupportedLocale; label: string }[] = [
  { key: 'zh-CN', label: '中文' },
  { key: 'en-US', label: 'English' },
];

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    defaultNS,
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
    },
  });
}

export default i18n;
