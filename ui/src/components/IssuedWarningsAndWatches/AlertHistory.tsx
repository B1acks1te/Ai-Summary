import { Badge } from '@/components/ui/badge';
import { formatUTCToNZDate } from '@/lib/utils';

import type { IssuedAlert } from '@/types/alert';
import { AlertIndicator } from './AlertIndicator';
import { DetailsToggle } from './DetailsToggle';
import { getPeriodDescription } from './utils';
import { diffWords, hasDiff, type DiffToken } from './wordDiff';

// Renders text with word-level diff highlighting against the previous
// revision. If there's nothing to compare against (oldest entry) or nothing
// changed, just renders the plain text — no highlighting noise on entries
// that are identical to what came before.
function DiffText({
  current,
  previous,
}: {
  current: string;
  previous?: string;
}) {
  if (previous === undefined) {
    return <>{current}</>;
  }
  const tokens = diffWords(previous, current);
  if (!hasDiff(tokens)) {
    return <>{current}</>;
  }
  return (
    <>
      {tokens
        .filter((t) => !t.removed)
        .map((t: DiffToken, idx) => (
          <span
            key={idx}
            className={
              t.added ? 'bg-green-100 text-green-800 rounded px-0.5' : undefined
            }
          >
            {t.value}
          </span>
        ))}
    </>
  );
}

export function AlertHistory({ history }: { history: IssuedAlert[] }) {
  return (
    <div>
      <div className="flex flex-col items-center justify-center mb-4">
        <h4 className="font-bold">Timeline ({history.length})</h4>
        {history.length > 1 && (
          <p className="text-[0.7rem] text-gray-500 mt-1">
            <span className="bg-green-100 text-green-800 rounded px-0.5">
              Highlighted
            </span>{' '}
            text changed from the previous revision.
          </p>
        )}
      </div>
      <div className="w-full px-4 max-h-160 overflow-y-auto text-[0.9rem]">
        {history.map((i, index) => {
          // history is newest-first; the "previous" version chronologically
          // is the next entry in the array (older). The oldest entry has
          // nothing to diff against.
          const previous = history[index + 1];

          return (
            <div
              key={i.id}
              className="mb-4 w-full border p-4 rounded-md shadow bg-white"
            >
              <div className="text-xs mb-1 flex items-center relative">
                <span onClick={() => console.log(i.id)}>
                  {formatUTCToNZDate(new Date(i.sent))}
                </span>
                {index === 0 && (
                  <Badge className="absolute right-0 mx-2">Latest</Badge>
                )}
              </div>
              <AlertIndicator data={i} />
              <div>
                <span className="font-bold">Area: </span>
                <span>
                  <DiffText
                    current={i.areaDesc.replace(/,/g, ', ')}
                    previous={previous?.areaDesc.replace(/,/g, ', ')}
                  />
                </span>
              </div>
              <div>
                <span className="font-bold">Period: </span>
                <span>
                  <DiffText
                    current={getPeriodDescription(i.onset, i.expires)}
                    previous={
                      previous
                        ? getPeriodDescription(previous.onset, previous.expires)
                        : undefined
                    }
                  />
                </span>
              </div>
              <div>
                <span className="font-bold">ChanceOfUpgrade: </span>
                <span>
                  <DiffText
                    current={i.ChanceOfUpgrade || 'N/A'}
                    previous={
                      previous ? previous.ChanceOfUpgrade || 'N/A' : undefined
                    }
                  />
                </span>
              </div>
              <div>
                <DetailsToggle issuedAlert={i} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}