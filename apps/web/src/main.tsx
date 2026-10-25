import '@fontsource-variable/heebo/index.css';
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/AppProviders';
import { isSigningPath } from './app/area';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}
const root = createRoot(rootElement);

// Load only the area this address belongs to: an employee never downloads the staff screens.
const loadApp: Promise<ComponentType> = isSigningPath(window.location.pathname)
  ? import('./sign/SignApp').then((module) => module.SignApp)
  : import('./admin/StaffApp').then((module) => module.StaffApp);

void loadApp.then((App) => {
  root.render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
});
