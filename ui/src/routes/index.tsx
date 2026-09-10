import { createFileRoute } from '@tanstack/react-router';

import { AISummary } from '@/components/AISummary';
import Header from '@/components/Header';
import IssuedWarningsAndWatches from '@/components/IssuedWarningsAndWatches';
import SevereWeatherOutlook from '@/components/SevereWeatherOutlook';
import ThunderstormOutlook from '@/components/ThunderstormOutlook';
import { Toaster } from '@/components/ui/sonner';

export const Route = createFileRoute('/')({ component: App });

function App() {
  return (
    <div className="flex flex-col h-dvh w-full overscroll-none">
      <Header />
      {/* Below lg: panels stack vertically instead of squeezing into a
          3-column row. Each panel keeps its own existing internal scroll
          (AISummary/IssuedWarningsAndWatches/outlooks already scroll
          internally at h-full), given a bounded height here so that
          works; `main` itself also scrolls so you can reach the next
          panel. At lg+ this is exactly the original 3-column layout,
          unchanged. */}
      <main className="flex flex-col lg:flex-row flex-1 m-2 gap-3 min-h-0 overflow-y-auto lg:overflow-visible">
        <Toaster position="top-center" offset={6} />
        <div className="h-[70vh] shrink-0 lg:h-auto lg:flex-1 lg:min-w-0">
          <AISummary />
        </div>
        <div className="h-[70vh] shrink-0 lg:h-auto lg:w-90 lg:shrink-0">
          <IssuedWarningsAndWatches />
        </div>
        <div className="h-[70vh] shrink-0 lg:h-auto lg:w-[30%] lg:min-h-full lg:shrink-0">
          <SevereWeatherOutlook />

          <ThunderstormOutlook />
        </div>
      </main>
      {/* <button
        onClick={() => {
          // toastSuccess('Test Success', 'This is a success message!');
          // toastInfo('Test Success', 'This is a success message!');
          // toastUpdateToDate('Test Update', 'This is an update message!');
          // toastError('Test Error', 'This is an error message!');
        }}
      >
        123
      </button> */}
    </div>
  );
}