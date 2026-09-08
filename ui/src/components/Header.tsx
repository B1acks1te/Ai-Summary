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
      <div className="flex items-center h-18 font-bold">
        <div className="flex-1 text-2xl bg-[#0065B3] h-full flex items-center text-white px-4 py-2">
          Meteorological Ai Scraping Tool
          <nav className="ml-auto flex gap-4 text-sm font-normal">
            <Link
              to="/"
              className="px-3 py-1 rounded hover:bg-white/15 transition-colors"
              activeProps={{ className: 'bg-white/20 px-3 py-1 rounded' }}
              activeOptions={{ exact: true }}
            >
              Dashboard
            </Link>
            <Link
              to="/gantt"
              className="px-3 py-1 rounded hover:bg-white/15 transition-colors"
              activeProps={{ className: 'bg-white/20 px-3 py-1 rounded' }}
            >
              Gantt
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}