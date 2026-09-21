import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { useMediaQuery, useNHISChannel } from '@/hooks';
import { EVENT } from '@/lib/ably';
import { trackEvent } from '@/lib/analytics';
import { setFeedbackContext } from '@/lib/feedbackContext';
import {
  toastError,
  toastInfo,
  toastSuccess,
  toastUpdateToDate,
} from '@/lib/toast';
import { cn, formatUTCToNZDate } from '@/lib/utils';
import { useIssuedWarningsAndWatches } from '@/queries';
import { store } from '@/store';
import type { IssuedAlert } from '@/types/alert';
import { sortAlerts } from '@/utils';
import { createServerFn } from '@tanstack/react-start';
import { useStore } from '@tanstack/react-store';
import lodash from 'lodash';
import { RefreshCcw } from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { AlertHistory } from './AlertHistory';
import { AlertIndicator } from './AlertIndicator';
import { DetailsToggle } from './DetailsToggle';
import { getPeriodDescription } from './utils';

const MESSAGE_HEADER = 'Issued Warnings and Watches';

export default function IssuedWarningsAndWatches() {
  const {
    data: issuedWarningsAndWatches,
    error: _error,
    isLoading,
    refetch,
  } = useIssuedWarningsAndWatches();

  const [isUpdating, setIsUpdating] = useState(false);

  // Give the Feedback form some dashboard context (counts and times only).
  const alertsUpdatedAt = issuedWarningsAndWatches?.updatedAt;
  const alertsCount = issuedWarningsAndWatches?.entries.length;
  useEffect(() => {
    setFeedbackContext({
      alerts_last_updated: alertsUpdatedAt
        ? formatUTCToNZDate(alertsUpdatedAt)
        : undefined,
      alerts_count: alertsCount,
    });
    return () =>
      setFeedbackContext({
        alerts_last_updated: undefined,
        alerts_count: undefined,
      });
  }, [alertsUpdatedAt, alertsCount]);

  useNHISChannel((message) => {
    console.log(
      `Received ${message.name} message: ${JSON.stringify(message.data)} at ${DateTime.now().setZone('Pacific/Auckland').toISO()}`,
    );

    switch (message.name) {
      case EVENT.ISSUED_ALERTS_UPDATING: {
        setIsUpdating(true);
        toastInfo(MESSAGE_HEADER, message.data.message);
        break;
      }
      case EVENT.ISSUED_ALERTS_UPDATED: {
        if (message.data.failed) {
          toastError(MESSAGE_HEADER, message.data.message);
        } else {
          if (message.data.stale) {
            toastSuccess(MESSAGE_HEADER, message.data.message);
            refetch();
          } else {
            toastUpdateToDate(MESSAGE_HEADER, message.data.message);
          }
        }
        setIsUpdating(false);
        break;
      }
      default:
        break;
    }
  });

  const updateIssuedAlerts = useCallback(
    lodash.throttle(async () => {
      if (!isUpdating) {
        trackEvent('refresh_click', { panel: 'issued_alerts' });
        await fetchLatestIssuedAlerts();
      }
    }, 10000),
    [],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issued Warnings And Watches</CardTitle>
        <CardDescription>
          <div className="flex items-center gap-4">
            <span>
              Source:{' '}
              <a
                href="https://www.metservice.com/warnings/home"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                MetService
              </a>
            </span>
            <RefreshCcw
              className={cn({
                'animate-spin': isUpdating,
                'cursor-pointer hover:scale-110': !isUpdating,
              })}
              onClick={updateIssuedAlerts}
              size={16}
            />
          </div>
          <div>
            Last updated:{' '}
            {issuedWarningsAndWatches?.updatedAt
              ? formatUTCToNZDate(issuedWarningsAndWatches.updatedAt)
              : ''}
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col gap-2 w-75 text-[0.9rem]">
            {issuedWarningsAndWatches &&
            issuedWarningsAndWatches.entries.length > 0 ? (
              sortAlerts(issuedWarningsAndWatches.entries).map((i) => {
                return <AlertCard issuedAlert={i} key={i.id} />;
              })
            ) : (
              <div className="flex items-center gap-4">
                {/* <AllgoodIcon /> */}
                <span> No issued warnings or watches.</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 w-full">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  );
}

// A "reissue" is when the latest revision matches the one before it on the
// things that matter operationally: area, period, chance of upgrade and
// severity (both the CAP severity and the colour code, since a colour change
// is a real upgrade/downgrade). Wording changes in the description are
// deliberately ignored. Needs at least two revisions to compare. History is
// newest-first, so [0] is the latest and [1] is the one it replaced.
function isReissue(history: IssuedAlert[]): boolean {
  if (history.length < 2) return false;
  const [latest, previous] = history;
  const norm = (v: string | undefined) => (v ?? '').trim();
  return (
    norm(latest.areaDesc) === norm(previous.areaDesc) &&
    norm(latest.onset) === norm(previous.onset) &&
    norm(latest.expires) === norm(previous.expires) &&
    norm(latest.ChanceOfUpgrade) === norm(previous.ChanceOfUpgrade) &&
    norm(latest.severity) === norm(previous.severity) &&
    norm(latest.ColourCode) === norm(previous.ColourCode)
  );
}

function AlertCard({ issuedAlert }: { issuedAlert: IssuedAlert }) {
  const {
    id,
    sent,
    _status,
    _history,
    areaDesc,
    onset,
    expires,
    ChanceOfUpgrade,
    // description intentionally unused here; Details component uses the whole object
    // keep property to avoid changing shape
  } = issuedAlert;

  // A reissue is technically an "updated" alert (new ID replacing the old
  // one) but nothing meaningful changed, so show Reissue instead of Updated.
  const reissue = isReissue(_history);
  const hasHistory = _history.length > 0;

  // The Timeline pops out beside the card on hover, but only where that works:
  // a desktop-sized window with a mouse. On phones, tablets and narrow windows
  // there is no hover and no room beside the card, so it opens as a dialog you
  // tap open instead.
  const canHover = useMediaQuery(
    '(hover: hover) and (pointer: fine) and (min-width: 1024px)',
  );
  const [hoverOpen, setHoverOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const countBadge = (
    <Badge title="Number of history" className={'text-xs right-0 font-semibold'}>
      {_history.length}
    </Badge>
  );

  const scrollIntoViewRef = useRef<HTMLDivElement | null>(null);

  const activeAlertReference = useStore(
    store,
    (state) => state.activeAlertReference,
  );

  const ref =
    activeAlertReference &&
    activeAlertReference.alertIds.length > 0 &&
    activeAlertReference.alertIds[0] === id
      ? scrollIntoViewRef
      : null;

  useEffect(() => {
    if (activeAlertReference?.alertIds.length === 0) return;
    if (scrollIntoViewRef.current) {
      scrollIntoViewRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [activeAlertReference]);
  return (
    <>
      <HoverCard
        open={canHover && hoverOpen}
        onOpenChange={(open) => {
          setHoverOpen(open);
          // only count it when there is actually a timeline to show
          if (open && hasHistory) trackEvent('alert_timeline_view');
        }}
      >
        <HoverCardTrigger asChild>
          <div
            ref={ref}
            className={cn(
              'mb-4 w-full border p-4 rounded-md shadow transition-all',
              activeAlertReference?.alertIds.includes(id) &&
                'border-blue-500 bg-blue-50',
              _status === 'removed'
                ? 'opacity-50 bg-gray-100'
                : 'hover:border-blue-500',
            )}
          >
            <div className="text-xs text-gray-500 mb-1 relative flex items-center justify-between">
              <span onClick={() => console.log(id)}>
                {formatUTCToNZDate(new Date(sent))}
              </span>
              <div className="flex gap-1 justify-center items-center">
                {_status && !(reissue && _status === 'updated') && (
                  <Badge
                    variant={'outline'}
                    className={cn(
                      'text-xs right-0 font-semibold capitalize',
                      _status === 'updated' && 'border-blue-500 text-blue-500',
                      _status === 'removed' && 'border-gray-500 text-gray-500',
                      _status === 'new' && 'border-green-600 text-green-600',
                    )}
                  >
                    {_status}
                  </Badge>
                )}
                {hasHistory &&
                  (canHover ? (
                    countBadge
                  ) : (
                    <button
                      type="button"
                      onClick={() => setHistoryOpen(true)}
                      aria-label={`Show history (${_history.length} versions)`}
                      className="cursor-pointer"
                    >
                      {countBadge}
                    </button>
                  ))}
                {reissue && (
                  <Badge
                    variant={'outline'}
                    title="No change to area, period, chance of upgrade or severity"
                    className="text-xs font-semibold border-amber-500 text-amber-600"
                  >
                    Reissue
                  </Badge>
                )}
              </div>
            </div>
            <AlertIndicator data={issuedAlert} />
            <div>
              <span className="font-bold">Area: </span>
              <span>{areaDesc.replace(/,/g, ', ')}</span>
            </div>
            <div>
              <span className="font-bold">Period: </span>
              <span>{getPeriodDescription(onset, expires)}</span>
            </div>
            <div>
              <span className="font-bold">Chance Of Upgrade: </span>
              <span>{ChanceOfUpgrade || 'N/A'}</span>
            </div>

            {!canHover && hasHistory && (
              <div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="text-sm text-blue-600 hover:underline mt-2"
                >
                  View history ({_history.length})
                </button>
              </div>
            )}
            <div>
              <DetailsToggle issuedAlert={issuedAlert} />
            </div>
          </div>
        </HoverCardTrigger>
        {hasHistory && (
          <HoverCardContent className="w-90 bg-gray-50 ml-2" side="right">
            <AlertHistory history={_history} />
          </HoverCardContent>
        )}
      </HoverCard>
      {!canHover && hasHistory && (
        <Dialog
          open={historyOpen}
          onOpenChange={(open) => {
            setHistoryOpen(open);
            if (open) trackEvent('alert_timeline_view');
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto p-3 sm:max-w-lg sm:p-6">
            <DialogHeader className="sr-only">
              <DialogTitle>Alert history</DialogTitle>
              <DialogDescription>
                Every version of this alert, newest first.
              </DialogDescription>
            </DialogHeader>
            <AlertHistory history={_history} maxHeightClass="max-h-none" />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const fetchLatestIssuedAlerts = createServerFn().handler(() => {
  fetch(process.env.MAIN_SERVICES_URL! + '/update-issued-alerts');
});