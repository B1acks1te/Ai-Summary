import { Link } from '@tanstack/react-router';

export default function Header() {
  return (
    <div className="flex items-center h-18 font-bold ml-4">
      <LeftYellowLogo />
      <div className="flex-1 text-2xl ml-8 bg-[#0065B3] h-full flex items-center text-white px-4 py-2">
        Natural Hazard Intelligence Summary
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
  );
}

function LeftYellowLogo() {
  return (
    <div className="flex gap-8">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="w-6 h-10 bg-[#FFE600] -skew-x-30"></div>
      ))}
    </div>
  );
}
