import Alert from '@mui/material/Alert';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { he } from '../../i18n/he';

const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange);
const isOnline = () => onlineManager.isOnline();

/** A thin bar while the browser is offline. Queries wait and run again once it is back. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, isOnline);
  if (online) return null;
  return (
    <Alert severity="warning" sx={{ borderRadius: 0, borderInline: 0, borderTop: 0 }}>
      {he.feedback.offline}
    </Alert>
  );
}
