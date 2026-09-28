'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker in production only. In development a worker
 * serves stale bundles and makes "why isn't my change showing" a daily event.
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Offline caching is an enhancement; failing to register is not an error
         the visitor needs to know about. */
    });
  }, []);
  return null;
}
