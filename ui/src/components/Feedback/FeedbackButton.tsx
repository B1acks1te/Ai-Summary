import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { trackEvent } from '@/lib/analytics';
import { getFeedbackContext } from '@/lib/feedbackContext';
import { submitFeedback, type FeedbackType } from '@/serverFuncs/Feedback';
import { useState } from 'react';

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: 'bug', label: "Bug - something isn't working" },
  { value: 'data', label: 'Wrong or missing data' },
  { value: 'change', label: 'Change request' },
  { value: 'feature', label: 'New feature idea' },
  { value: 'question', label: 'Question' },
];

const MAX_LENGTH = 2000;
const MIN_LENGTH = 5;
const CLIENT_ID_KEY = 'feedback-client-id';

// A random, anonymous ID kept in this browser, only used to stop one browser
// flooding the form. It isn't linked to a person.
function getClientId(): string {
  try {
    let id = window.localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id =
        typeof window.crypto?.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType | ''>('');
  const [description, setDescription] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState(''); // honeypot - stays empty
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState<string | null>(null);

  const reset = () => {
    setType('');
    setDescription('');
    setContact('');
    setWebsite('');
    setError('');
    setReference(null);
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      trackEvent('feedback_open');
    } else if (reference) {
      // after a successful send, start with a clean form next time
      reset();
    }
  };

  const canSend =
    type !== '' && description.trim().length >= MIN_LENGTH && !sending;

  const send = async () => {
    if (type === '') return;
    setSending(true);
    setError('');
    const resp = await submitFeedback({
      data: {
        type,
        description: description.trim(),
        contact: contact.trim(),
        page: window.location.pathname,
        context: {
          ...getFeedbackContext(),
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        userAgent: navigator.userAgent,
        clientId: getClientId(),
        website,
      },
    });
    setSending(false);
    if (resp.ok && resp.ref) {
      trackEvent('feedback_submit', { type });
      setReference(resp.ref);
    } else {
      setError(resp.error || 'Something went wrong. Please try again.');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="px-2 sm:px-3 py-1 rounded hover:bg-white/15 transition-colors cursor-pointer"
      >
        Feedback
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          {reference ? (
            <>
              <DialogHeader>
                <DialogTitle>Thanks - your feedback is in</DialogTitle>
                <DialogDescription>
                  Your reference is{' '}
                  <span className="font-semibold text-foreground">
                    {reference}
                  </span>
                  . Quote it if you follow up.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>Close</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Send feedback</DialogTitle>
                <DialogDescription>
                  Report a problem, ask for a change, or suggest something new.
                  Please don&apos;t include personal or sensitive information.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="font-medium">What kind of feedback?</span>
                  <select
                    value={type}
                    onChange={(e) =>
                      setType(e.target.value as FeedbackType | '')
                    }
                    className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    <option value="">Choose...</option>
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-medium">Details</span>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={MAX_LENGTH}
                    rows={6}
                    placeholder="What happened, or what would you like? For a bug, what did you expect to see instead?"
                    className="w-full rounded-md border p-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-400 self-end">
                    {description.length}/{MAX_LENGTH}
                  </span>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="font-medium">
                    Name or email{' '}
                    <span className="font-normal text-gray-500">
                      (optional - only if you&apos;d like a reply)
                    </span>
                  </span>
                  <Input
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    maxLength={200}
                  />
                </label>

                {/* Honeypot: hidden from people, but bots tend to fill it in. */}
                <input
                  type="text"
                  name="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px' }}
                />

                <p className="text-xs text-gray-500">
                  We also record the page you&apos;re on and your browser to
                  help us investigate.
                </p>

                {error && <p className="text-sm text-red-600">{error}</p>}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={send} disabled={!canSend}>
                  {sending ? 'Sending...' : 'Send feedback'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
