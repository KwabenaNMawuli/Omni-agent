import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// When running inside Electron, make html/body transparent
if ((window as any).omniAPI) {
  document.documentElement.classList.add('electron-overlay');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
