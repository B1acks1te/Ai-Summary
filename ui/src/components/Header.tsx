import { Link } from '@tanstack/react-router';

const SHOW_DEV_BANNER = import.meta.env.VITE_SHOW_DEV_BANNER === 'true';

function DevBanner() {
  const text = Array(40).fill('Development Site').join('   •   ');
  return (
    <div className="bg-[#FEF3C7] text-[#92400E] text-xs font-semibold py-1 overflow-hidden whitespace-nowrap select-none">
      {text}
    </div>
  );
}

export default function Header() {
  return (
    <div className="flex flex-col">
      {SHOW_DEV_BANNER && <DevBanner />}
      <div className="flex items-center min-h-14 sm:min-h-18 font-bold">
        <div className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base sm:text-xl lg:text-2xl bg-[#0065B3] h-full text-white px-3 sm:px-4 py-2">
          <span>Meteorological Ai Scraping Tool</span>
          <nav className="ml-auto flex gap-1.5 sm:gap-4 text-xs sm:text-sm font-normal">
            <Link
              to="/"
              className="px-2 sm:px-3 py-1 rounded hover:bg-white/15 transition-colors"
              activeProps={{ className: 'bg-white/20 px-2 sm:px-3 py-1 rounded' }}
              activeOptions={{ exact: true }}
            >
              Dashboard
            </Link>
            <Link
              to="/gantt"
              className="px-2 sm:px-3 py-1 rounded hover:bg-white/15 transition-colors"
              activeProps={{ className: 'bg-white/20 px-2 sm:px-3 py-1 rounded' }}
            >
              Gantt
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}