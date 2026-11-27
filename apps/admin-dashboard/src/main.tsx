import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@funti3r/ui/base.css';
import '@funti3r/ui/app.css';
import '@funti3r/ui/dashboard.css';
import './admin.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
