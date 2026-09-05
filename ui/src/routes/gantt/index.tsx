import { createFileRoute } from '@tanstack/react-router';
import { GanttGenerator } from '@/components/Gantt/GanttGenerator';
import Header from '@/components/Header';
import { Toaster } from '@/components/ui/sonner';

export const Route = createFileRoute('/gantt/')({
  component: GanttRoute,
});

function GanttRoute() {
  return (
    <div className="flex flex-col h-dvh w-full overscroll-none">
      <Header />
      <Toaster position="top-center" offset={6} />
      <main className="flex-1 overflow-auto">
        <GanttGenerator />
      </main>
    </div>
  );
}
