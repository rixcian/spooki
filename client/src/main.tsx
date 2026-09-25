import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Follow the system theme; coss uses a `.dark` class.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => {
  document.documentElement.classList.toggle('dark', dark.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark.matches ? '#0b1020' : '#fbfbfc');
};
applyTheme();
dark.addEventListener('change', applyTheme);

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
