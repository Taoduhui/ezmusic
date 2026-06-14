import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
// Initialize i18n before rendering
import '@ezmusic/shared';
import { ensureDebugLevel, DBG } from '@ezmusic/shared';

// Set the global debug verbosity level.
// In development builds you can override via:  window.debugLevel = 5
ensureDebugLevel(import.meta.env.DEV ? DBG.DEBUG : DBG.SILENT);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
