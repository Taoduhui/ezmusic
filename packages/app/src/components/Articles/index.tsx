import { useState, ReactNode, useCallback, useEffect, useMemo } from 'react';
import {
  Layout,
  Menu,
  Button,
  Drawer,
  Tag,
  Space,
  Grid,
  Typography,
  Select,
  Affix,
  Tooltip,
} from 'antd';
import {
  MenuOutlined,
  LeftOutlined,
  RightOutlined,
  SoundOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supportedLocales, i18n } from '@ezmusic/shared';
import type { SupportedLocale } from '@ezmusic/shared';

const { Sider, Content } = Layout;
const { useBreakpoint } = Grid;
const { Text } = Typography;

export interface PageConfig {
  path: string;
  title: string;
  optional?: boolean;
  page: () => ReactNode;
}

export interface ArticlesProps {
  pages: PageConfig[];
  defaultCurrent?: number;
}

const SIDER_WIDTH = 260;

export default function Articles({ pages, defaultCurrent = 0 }: ArticlesProps) {
  const { t } = useTranslation();
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;
  const location = useLocation();
  const routerNavigate = useNavigate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [locale, setLocale] = useState<SupportedLocale>(
    (i18n.resolvedLanguage as SupportedLocale) ?? 'zh-CN',
  );

  const currentIdx = useMemo(() => {
    const pathname = location.pathname !== '/' && location.pathname.endsWith('/')
      ? location.pathname.slice(0, -1)
      : location.pathname;

    return pages.findIndex((page) => page.path === pathname);
  }, [location.pathname, pages]);

  const resolvedCurrentIdx = currentIdx >= 0 ? currentIdx : defaultCurrent;

  useEffect(() => {
    const handleLanguageChanged = (value: string) => {
      setLocale((value as SupportedLocale) ?? 'zh-CN');
    };

    i18n.on('languageChanged', handleLanguageChanged);
    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, []);

  const handleLocaleChange = useCallback((val: SupportedLocale) => {
    setLocale(val);
    i18n.changeLanguage(val);
  }, []);

  useEffect(() => {
    if (currentIdx >= 0 || !pages[defaultCurrent]) {
      return;
    }

    routerNavigate(pages[defaultCurrent].path, { replace: true });
  }, [currentIdx, defaultCurrent, pages, routerNavigate]);

  const goToPage = useCallback((idx: number) => {
    const target = pages[idx];
    if (!target) return;

    routerNavigate(target.path);
    setDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pages, routerNavigate]);

  const hasPrev = resolvedCurrentIdx > 0;
  const hasNext = resolvedCurrentIdx < pages.length - 1;
  const currentPage = pages[resolvedCurrentIdx];

  const menuItems = pages.map((p, idx) => ({
    key: p.path,
    label: (
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Text
          style={{
            color: idx === resolvedCurrentIdx ? '#7c3aed' : undefined,
            fontWeight: idx === resolvedCurrentIdx ? 600 : 400,
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: 'normal',
            wordBreak: 'break-all',
          }}
        >
          {p.title}
        </Text>
        {p.optional && (
          <Tag
            color="purple"
            style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', flexShrink: 0 }}
          >
            {t('nav.optional')}
          </Tag>
        )}
      </Space>
    ),
  }));

  const siderContent = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#fff',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '24px 20px 20px',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <SoundOutlined style={{ color: '#fff', fontSize: 18 }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2, color: '#1a1a2e' }}>
              {t('app.title')}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              {t('app.subtitle')}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation label */}
      <div style={{ padding: '16px 20px 8px', flexShrink: 0 }}>
        <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('nav.menu')}
        </Text>
      </div>

      {/* Menu */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Menu
          mode="inline"
          selectedKeys={[currentPage.path]}
          items={menuItems}
          onSelect={({ key }) => {
            const idx = pages.findIndex((page) => page.path === key);
            if (idx >= 0) goToPage(idx);
          }}
          style={{ border: 'none', background: 'transparent' }}
        />
      </div>

      {/* Language switcher */}
      <div
        style={{
          padding: '16px 20px',
          borderTop: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          {t('lang.switchLang')}
        </Text>
        <Select
          value={locale}
          onChange={handleLocaleChange}
          options={supportedLocales.map((l) => ({ value: l.key, label: l.label }))}
          style={{ width: '100%' }}
          size="small"
        />
      </div>
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      {/* Desktop Sider */}
      {isDesktop && (
        <Sider
          width={SIDER_WIDTH}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            height: '100vh',
            overflow: 'hidden',
            borderRight: '1px solid #f0f0f0',
            zIndex: 100,
            background: '#fff',
          }}
        >
          {siderContent}
        </Sider>
      )}

      {/* Mobile Drawer */}
      {!isDesktop && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          placement="left"
          width={SIDER_WIDTH}
          styles={{ body: { padding: 0 }, header: { display: 'none' } }}
          closeIcon={null}
        >
          <div style={{ position: 'relative', height: '100%' }}>
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={() => setDrawerOpen(false)}
              style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}
            />
            {siderContent}
          </div>
        </Drawer>
      )}

      {/* Main content area */}
      <Layout
        style={{
          marginLeft: isDesktop ? SIDER_WIDTH : 0,
          minHeight: '100vh',
          background: '#f7f8fa',
        }}
      >
        {/* Mobile top bar */}
        {!isDesktop && (
          <Affix offsetTop={0}>
            <div
              style={{
                background: '#fff',
                borderBottom: '1px solid #f0f0f0',
                padding: '0 16px',
                height: 56,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                zIndex: 99,
              }}
            >
              <Tooltip title={t('nav.openMenu')}>
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => setDrawerOpen(true)}
                />
              </Tooltip>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SoundOutlined style={{ color: '#7c3aed' }} />
                <Text strong style={{ fontSize: 15 }}>
                  {t('app.title')}
                </Text>
              </div>
              <Select
                value={locale}
                onChange={handleLocaleChange}
                options={supportedLocales.map((l) => ({ value: l.key, label: l.label }))}
                size="small"
                style={{ width: 90 }}
              />
            </div>
          </Affix>
        )}

        {/* Content */}
        <Content>
          <div
            style={{
              maxWidth: 960,
              margin: '0 auto',
              padding: isDesktop ? '48px 48px 80px' : '24px 0 80px',
            }}
          >
            {/* Chapter label */}
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('nav.chapter', { index: resolvedCurrentIdx + 1 })}
                {currentPage.optional && (
                  <Tag color="purple" style={{ marginLeft: 8, fontSize: 11 }}>
                    {t('nav.optional')}
                  </Tag>
                )}
              </Text>
            </div>

            {/* Page content */}
            <div key={currentPage.path} style={{ animation: 'fadeIn 0.25s ease' }}>
              {currentPage.page()}
            </div>

            {/* Bottom navigation – only shown when there are multiple pages */}
            {pages.length > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 64,
                paddingTop: 24,
                borderTop: '1px solid #f0f0f0',
                gap: 16,
              }}
            >
              <Button
                size="large"
                icon={<LeftOutlined />}
                onClick={() => goToPage(resolvedCurrentIdx - 1)}
                disabled={!hasPrev}
                style={{ borderRadius: 8 }}
              >
                {t('nav.prev')}
              </Button>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {resolvedCurrentIdx + 1} / {pages.length}
              </Text>
              <Button
                type="primary"
                size="large"
                icon={<RightOutlined />}
                iconPosition="end"
                onClick={() => goToPage(resolvedCurrentIdx + 1)}
                disabled={!hasNext}
                style={{ borderRadius: 8, background: '#7c3aed', borderColor: '#7c3aed' }}
              >
                {t('nav.next')}
              </Button>
            </div>
            )}
          </div>
        </Content>
      </Layout>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ant-menu-item {
          height: auto !important;
          min-height: 40px !important;
          padding-top: 8px !important;
          padding-bottom: 8px !important;
        }
        .ant-menu-item .ant-menu-title-content {
          white-space: normal !important;
        }
      `}</style>
    </Layout>
  );
}
