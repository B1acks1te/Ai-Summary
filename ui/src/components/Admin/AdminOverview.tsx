import { getAdminStats, type AdminStats } from '@/serverFuncs/Admin';
import { listFeedback } from '@/serverFuncs/Feedback';
import { listNotices } from '@/serverFuncs/Notice';
import { useEffect, useState } from 'react';

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-white p-4">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {sub && <span className="text-xs text-gray-500">{sub}</span>}
    </div>
  );
}

export function AdminOverview({ adminKey }: { adminKey: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [feedbackNewCount, setFeedbackNewCount] = useState<number | null>(null);
  const [currentNoticeLabel, setCurrentNoticeLabel] = useState('Loading...');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      const [statsResp, feedbackResp, noticesResp] = await Promise.all([
        getAdminStats({ data: { adminKey } }),
        listFeedback({ data: { adminKey, status: 'new' } }),
        listNotices({ data: { adminKey } }),
      ]);
      if (cancelled) return;
      if (statsResp.ok) {
        setStats(statsResp.stats);
      } else {
        setError(statsResp.error);
      }
      setFeedbackNewCount(
        feedbackResp.ok && feedbackResp.items
          ? feedbackResp.items.length
          : null,
      );
      if (noticesResp.ok && noticesResp.items) {
        const live = noticesResp.items.find((n) => {
          if (!n.enabled) return false;
          const now = Date.now();
          if (n.startAt && now < new Date(n.startAt).getTime()) return false;
          if (n.endAt && now >= new Date(n.endAt).getTime()) return false;
          return true;
        });
        setCurrentNoticeLabel(live ? live.message : 'None live right now');
      } else {
        setCurrentNoticeLabel('Could not load');
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [adminKey]);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading overview...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="rounded-lg border bg-white p-4">
        <span className="text-xs text-gray-500">Current site notice</span>
        <p className="text-sm font-medium mt-1">{currentNoticeLabel}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="New feedback"
          value={feedbackNewCount === null ? '-' : String(feedbackNewCount)}
          sub="Awaiting triage"
        />
        <StatTile
          label="Severe Weather Outlooks"
          value={stats ? String(stats.severeWeatherOutlook.count) : '-'}
          sub={`Last scraped: ${formatWhen(stats?.severeWeatherOutlook.lastInsertedAt ?? null)}`}
        />
        <StatTile
          label="Thunderstorm Outlooks"
          value={stats ? String(stats.thunderstormOutlook.count) : '-'}
          sub={`Last scraped: ${formatWhen(stats?.thunderstormOutlook.lastInsertedAt ?? null)}`}
        />
        <StatTile
          label="Issued Warnings & Watches"
          value={stats ? String(stats.issuedAlerts.count) : '-'}
          sub={`Last scraped: ${formatWhen(stats?.issuedAlerts.lastInsertedAt ?? null)}`}
        />
      </div>

      <p className="text-xs text-gray-400">
        These are database record counts and the last time each collection
        received a new entry - not a live scraper status.
      </p>
    </div>
  );
}
