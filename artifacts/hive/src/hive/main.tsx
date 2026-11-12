import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import App from './App';
import './styles.css';
import { initMotion } from './motion/prefs';

initMotion();

ModuleRegistry.registerModules([AllCommunityModule]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
