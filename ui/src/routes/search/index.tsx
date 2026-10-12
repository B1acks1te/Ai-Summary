import { AdminDebug } from '@/components/Admin/AdminDebug';
import { AdminOverview } from '@/components/Admin/AdminOverview';
import { AdminShell } from '@/components/Admin/AdminShell';
import { FeedbackAdmin } from '@/components/Feedback/FeedbackAdmin';
import { NoticeAdmin } from '@/components/Notice/NoticeAdmin';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/search/')({
  component: RouteComponent,
  ssr: false,
});

// A dedicated Admin UI: one sign-in gate, then tabs across the top instead
// of five separate panels (and three ungated raw-ID lookups) stacked down
// one long page.
function RouteComponent() {
  return (
    <div className="p-8">
      <AdminShell
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (adminKey) => <AdminOverview adminKey={adminKey} />,
          },
          {
            value: 'notices',
            label: 'Site notice',
            content: () => <NoticeAdmin />,
          },
          {
            value: 'feedback',
            label: 'Feedback',
            content: () => <FeedbackAdmin />,
          },
          {
            value: 'debug',
            label: 'Debug / Advanced',
            content: (adminKey) => <AdminDebug adminKey={adminKey} />,
          },
        ]}
      />
    </div>
  );
}
