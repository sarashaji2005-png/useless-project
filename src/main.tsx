import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyDesignTokens } from './design/tokens';
import './index.css';
import './design/components.css';

// Injected before first render so no frame paints with the fallback palette.
applyDesignTokens();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
