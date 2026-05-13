import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Articles from './components/Articles';
import ChapterNoteSolfege from '@ezmusic/chapter-note-solfege';
import ChapterStaffNotation from '@ezmusic/chapter-staff-notation';
// Initialize i18n
import '@ezmusic/shared';

const antdLocaleMap: Record<string, typeof zhCN> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export default function App() {
  const { i18n } = useTranslation();
  const [antdLocale, setAntdLocale] = useState(zhCN);

  useEffect(() => {
    const handleLangChange = (lng: string) => {
      setAntdLocale(antdLocaleMap[lng] ?? zhCN);
    };
    i18n.on('languageChanged', handleLangChange);
    return () => {
      i18n.off('languageChanged', handleLangChange);
    };
  }, [i18n]);

  const pages = [
    {
      title: '音名与唱名',
      page: () => <ChapterNoteSolfege />,
    },
    {
      title: '认识五线谱',
      page: () => <ChapterStaffNotation />,
    },
  ];

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        token: {
          colorPrimary: '#7c3aed',
          colorLink: '#7c3aed',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        },
        algorithm: theme.defaultAlgorithm,
      }}
    >
      <Articles pages={pages} />
    </ConfigProvider>
  );
}
