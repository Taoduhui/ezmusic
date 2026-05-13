import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Initialize i18n before rendering
import '@ezmusic/shared';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
