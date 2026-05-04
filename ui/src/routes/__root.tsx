import { ABLY_CHANNEL_NAME } from '@/ablyChannel';
import { TanStackDevtools } from '@tanstack/react-devtools';
import type { QueryClient } from '@tanstack/react-query';
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { Analytics } from '@vercel/analytics/react';
import * as Ably from 'ably';
import { AblyProvider, ChannelProvider } from 'ably/react';
import { useEffect, useState } from 'react';
import TanStackQueryDevtools from '../integrations/tanstack-query/devtools';
import appCss from '../styles.css?url';

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Natural Hazard Intelligence Summary',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/favicon.ico?v=2',
      },
    ],
  }),

  shellComponent: RootDocument,
});

const isBrowser = typeof window !== 'undefined';

// ────────────────────────────────────────────────────────────────
// Ably client construction.
//
// Three constraints to satisfy:
//
// 1. Ably v2 rejects authUrl values that begin with "/" when its
//    internal HTTP layer has prefixUrl set. Use authCallback to do
//    the fetch ourselves.
//
// 2. We MUST NOT actually connect to Ably during SSR — Node has no
//    browser origin, so a relative fetch URL fails to parse.
//
// 3. Components downstream call useChannel() unconditionally during
//    render, so we MUST provide an AblyProvider+ChannelProvider on
//    BOTH server and client renders. If we omit them on the server,
//    useChannel crashes reading .client from undefined.
//
// The solution: construct the SDK with autoConnect:false on the
// server. The object exists and satisfies the providers' contract,
// but nothing reaches over the wire. On the client, build a normal
// connecting client.
// ────────────────────────────────────────────────────────────────
function createAblyClient(): Ably.Realtime {
  if (!isBrowser) {
    // SSR stub — real key value is irrelevant since autoConnect is off.
    // The 'fake.fake:fake' format satisfies the SDK's internal parsing
    // without us having to expose anything at build time.
    return new Ably.Realtime({
      key: 'fake.fake:fake',
      autoConnect: false,
      clientId: 'nhis-client-ssr',
    });
  }

  return new Ably.Realtime({
    authCallback: async (_tokenParams, callback) => {
      try {
        const resp = await fetch('/ably/create-token');
        if (!resp.ok) {
          throw new Error(`Token endpoint returned HTTP ${resp.status}`);
        }
        const tokenRequest = await resp.json();
        callback(null, tokenRequest);
      } catch (err) {
        callback((err as Error)?.message || String(err), null);
      }
    },
    clientId: 'nhis-client',
  });
}

// Module-level: created once per render context.
// On the server, this is a no-op stub that satisfies the provider
// contract during SSR. On the client, this is the real connecting
// client (the useEffect below replaces it via state for clarity, but
// a single module-level instance would also work in practice).
const initialAblyClient = createAblyClient();

function RootDocument({ children }: { children: React.ReactNode }) {
  const [ablyClient, setAblyClient] = useState<Ably.Realtime>(
    initialAblyClient,
  );

  useEffect(() => {
    // Once we're hydrated on the client, swap in a real connecting
    // client if we somehow ended up with the SSR stub (e.g. when
    // module evaluation happened on the server).
    if (!ablyClient.connection || ablyClient.connection.state === 'initialized') {
      const realClient = new Ably.Realtime({
        authCallback: async (_tokenParams, callback) => {
          try {
            const resp = await fetch('/ably/create-token');
            if (!resp.ok) {
              throw new Error(`Token endpoint returned HTTP ${resp.status}`);
            }
            const tokenRequest = await resp.json();
            callback(null, tokenRequest);
          } catch (err) {
            callback((err as Error)?.message || String(err), null);
          }
        },
        clientId: 'nhis-client',
      });
      setAblyClient(realClient);
      return () => {
        realClient.close();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <html lang="en" className="light">
      <head>
        <HeadContent />
      </head>
      <body>
        <AblyProvider client={ablyClient}>
          <ChannelProvider channelName={ABLY_CHANNEL_NAME}>
            {children}
          </ChannelProvider>
        </AblyProvider>
        <Analytics />
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
