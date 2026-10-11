import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { verifyAdminKey } from '@/serverFuncs/Admin';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

// Same sessionStorage key Feedback/Notice have always used - signing in
// here also silently signs in NoticeAdmin and FeedbackAdmin, since they
// each check this same key on mount. No change needed to either component.
const KEY_STORAGE = 'feedback-admin-key';

// One shared sign-in gate for the whole Admin UI, instead of three separate
// password prompts stacked down the page. Nothing inside `tabs` renders
// until the key has been verified.
export function AdminShell({
  tabs,
}: {
  // Each tab's content is a function of the verified admin key, rather than
  // a fixed node, so tabs whose own server functions need to re-send the
  // key (Overview, Debug) get it without a second, separate sign-in step.
  tabs: {
    value: string;
    label: string;
    content: (adminKey: string) => ReactNode;
  }[];
}) {
  const [adminKey, setAdminKey] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  const trySignIn = async (key: string, { quiet }: { quiet: boolean }) => {
    if (!key) {
      setChecking(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError('');
    const resp = await verifyAdminKey({ data: { adminKey: key } });
    setLoading(false);
    setChecking(false);
    if (resp.ok) {
      setSignedIn(true);
      try {
        window.sessionStorage.setItem(KEY_STORAGE, key);
      } catch {
        // storage blocked - you'll just be asked again next time
      }
    } else if (!quiet) {
      setError(resp.error || "That password isn't right.");
    }
  };

  // On mount, try whatever key is already saved (from a previous sign-in on
  // this page or on the old Feedback/Notice panels) before showing a prompt.
  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(KEY_STORAGE);
      if (saved) {
        setAdminKey(saved);
        void trySignIn(saved, { quiet: true });
        return;
      }
    } catch {
      // ignore
    }
    setChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = () => {
    setSignedIn(false);
    setAdminKey('');
    setError('');
    try {
      window.sessionStorage.removeItem(KEY_STORAGE);
    } catch {
      // ignore
    }
  };

  if (checking) {
    return <p className="text-sm text-gray-500">Checking sign-in...</p>;
  }

  if (!signedIn) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-gray-50 p-6 max-w-md">
        <div>
          <h1 className="text-lg font-semibold">Admin sign-in</h1>
          <p className="text-xs text-gray-500">
            One password unlocks the whole Admin UI - overview, site notice,
            feedback, and the debug tools.
          </p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void trySignIn(adminKey, { quiet: false });
          }}
        >
          <input
            type="text"
            name="username"
            value="admin"
            autoComplete="username"
            readOnly
            tabIndex={-1}
            className="sr-only"
          />
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Password"
            className="max-w-xs"
            autoFocus
          />
          <Button type="submit" disabled={!adminKey || loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Button size="sm" variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
      <Tabs defaultValue={tabs[0]?.value}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="pt-2">
            {tab.content(adminKey)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
