import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Articles from './components/Articles';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';
import Tuner from './components/Tuner';
import SightSinging from './components/SightSinging';
import FretboardMemorization from './components/FretboardMemorization';
import SightReading from './components/SightReading';
import { NoteSolfegeIntervalDrill } from '@ezmusic/chapter-note-solfege';
import { DrillSession, StaffIntervalDrill } from '@ezmusic/chapter-staff-notation';
// Initialize i18n
import '@ezmusic/shared';

const antdLocaleMap: Record<string, typeof zhCN> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

export default function App() {
  const { i18n, t } = useTranslation();
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
      path: '/tuner',
      title: t('tuner.title'),
      page: () => <Tuner />,
      group: 'guitarRelated',
    },
    {
      path: '/sight-singing',
      title: t('sightSinging.title'),
      page: () => <SightSinging />,
      group: 'guitarRelated',
    },
    {
      path: '/fretboard-memorization',
      title: t('fretboardMemo.title'),
      page: () => <FretboardMemorization />,
      group: 'guitarRelated',
    },
    {
      path: '/sight-reading',
      title: t('sightReading.title'),
      page: () => <SightReading />,
      group: 'guitarRelated',
    },
    {
      path: '/interval-speed-drill',
      title: t('noteSolfege.intervalSpeedDrill'),
      page: () => <NoteSolfegeIntervalDrill />,
      group: 'other',
    },
    {
      path: '/note-reading-drill',
      title: t('staffNotation.drillTitle'),
      page: () => <DrillSession />,
      group: 'other',
    },
    {
      path: '/interval-drill',
      title: t('staffNotation.intervalDrillTitle'),
      page: () => <StaffIntervalDrill />,
      group: 'other',
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
      <PwaUpdatePrompt />
    </ConfigProvider>
  );
}
