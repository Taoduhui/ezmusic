import { useEffect, useRef } from 'react';
import { notification } from '@ezmusic/shared';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * PWA update check & prompt.
 *
 * - When a new service worker is found, shows a notification with an "update" action.
 * - When the app is ready for offline use, shows a brief informational message.
 */
export default function PwaUpdatePrompt() {
  const { t } = useTranslation();
  const notifiedRef = useRef(false);
  const offlineReadyNotifiedRef = useRef(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({
    onRegisteredSW(swScriptUrl, registration) {
      // Called when the SW is successfully registered
    },
    onRegisterError(error) {
      // Registration failed - ignore in production
    },
  });

  // Show update notification when a new version is available
  useEffect(() => {
    if (needRefresh && !notifiedRef.current) {
      notifiedRef.current = true;
      const key = `pwa-update-${Date.now()}`;
      notification.info({
        key,
        message: t('pwa.updateAvailable'),
        description: t('pwa.updateDescription'),
        btn: (
          <span
            style={{
              cursor: 'pointer',
              color: '#7c3aed',
              fontWeight: 600,
            }}
            onClick={async () => {
              // Close the notification
              notification.destroy(key);
              // Show updating status
              notification.info({
                message: t('pwa.updating'),
                duration: 0,
              });
              // Activate the new service worker and reload
              await updateServiceWorker(true);
            }}
          >
            {t('pwa.updateAction')}
          </span>
        ),
        duration: 0,
        placement: 'bottomRight',
      });
    }
  }, [needRefresh, t, updateServiceWorker]);

  // Show a brief notification when offline-ready (first time)
  useEffect(() => {
    if (offlineReady && !offlineReadyNotifiedRef.current) {
      offlineReadyNotifiedRef.current = true;
      notification.success({
        message: t('pwa.offlineReady'),
        duration: 3,
        placement: 'bottomRight',
      });
    }
  }, [offlineReady, t]);

  return null;
}
