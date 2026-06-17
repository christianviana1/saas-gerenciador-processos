/**
 * Root Layout — src/app/layout.tsx
 *
 * Provides the global HTML shell for the entire Next.js application.
 *
 * Responsibilities:
 *  1. HTML <head> metadata (title, description, theme, viewport)
 *  2. Web App Manifest link (PWA — Requirement 11.7)
 *  3. Service Worker registration script (PWA — Requirement 11.2, 11.4)
 *     - Registers /sw.js on page load
 *     - Requests Notification permission and subscribes to Web Push
 *     - Sends the PushSubscription to POST /api/push/subscribe
 *     - Listens for SW messages (update available → UI prompt handled separately)
 *  4. Global CSS
 *
 * Requirements: 11.2, 11.4, 11.5, 10.9
 */

import type { Metadata, Viewport } from 'next';
import './globals.css';

// ─────────────────────────────────────────────────────────────────────────────
// Metadata & Viewport
// ─────────────────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: {
    default: 'LegalSaaS — Gestão Jurídica',
    template: '%s | LegalSaaS',
  },
  description: 'Plataforma SaaS multi-tenant para gestão de processos jurídicos.',
  applicationName: 'LegalSaaS',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'LegalSaaS',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#1e40af',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Root Layout Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* PWA — link to manifest is injected automatically by Next.js
            via the `manifest` key in `metadata` above, but we keep it
            explicit for clarity and compatibility with older browsers. */}
        <link rel="manifest" href="/manifest.json" />

        {/* Apple touch icon for iOS home-screen installations */}
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}

        {/*
          Service Worker Registration + Web Push Subscription

          This inline script runs once after the page loads and:
            1. Registers /sw.js (or reuses the existing registration)
            2. Requests Notification permission from the user
            3. Subscribes to Web Push using the VAPID public key
            4. POSTs the PushSubscription JSON to /api/push/subscribe

          Security notes:
          - The script does NOT contain any secret material.
          - The VAPID public key is safe to expose — it is a public key by design.
          - `applicationServerKey` is the VAPID_PUBLIC_KEY converted to Uint8Array.
          - The subscription endpoint is user-specific and ephemeral.

          Requirements: 11.2, 11.4, 10.9
        */}
        <script
          id="sw-registration"
          // dangerouslySetInnerHTML is intentional here: this is a plain,
          // static script with no user input; React's JSX escaping would
          // corrupt the function bodies.
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  'use strict';

  // VAPID public key — safe to expose (it is a public key)
  var VAPID_PUBLIC_KEY = ${JSON.stringify(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '')};

  /**
   * Converts a URL-safe base64 string to a Uint8Array, as required by
   * PushManager.subscribe({ applicationServerKey }).
   */
  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /**
   * Sends the PushSubscription JSON to the server so the notification
   * worker can retrieve it at delivery time.
   */
  function saveSubscription(subscription) {
    return fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
      credentials: 'same-origin',
    }).catch(function (err) {
      console.warn('[SW] Failed to save push subscription:', err);
    });
  }

  /**
   * Subscribes to Web Push if permission has been granted and the VAPID
   * public key is available.
   */
  async function subscribeToPush(registration) {
    if (!VAPID_PUBLIC_KEY) return;

    try {
      var existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        // Already subscribed — ensure the server has the latest subscription
        await saveSubscription(existingSub);
        return;
      }

      var newSub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      await saveSubscription(newSub);
    } catch (err) {
      console.warn('[SW] Push subscription failed:', err);
    }
  }

  /**
   * Main entry point — runs after DOM is ready.
   */
  async function init() {
    if (!('serviceWorker' in navigator)) return;

    try {
      var registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });

      console.info('[SW] Service Worker registered:', registration.scope);

      // Request notification permission and subscribe to push
      if ('Notification' in window && 'PushManager' in window) {
        var permission = Notification.permission;

        if (permission === 'default') {
          // Only request permission after a short delay so we don't
          // interrupt the user immediately on page load.
          setTimeout(async function () {
            permission = await Notification.requestPermission();
            if (permission === 'granted') {
              await subscribeToPush(registration);
            }
          }, 3000);
        } else if (permission === 'granted') {
          await subscribeToPush(registration);
        }
      }

      // Listen for SW controller changes — a new version has taken over
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        // The PWAUpdatePrompt component handles this event and shows the UI;
        // we do NOT force-reload here (Requirement 11.5).
        console.info('[SW] New service worker is now in control.');
      });

    } catch (err) {
      console.error('[SW] Service Worker registration failed:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`,
          }}
        />
      </body>
    </html>
  );
}
