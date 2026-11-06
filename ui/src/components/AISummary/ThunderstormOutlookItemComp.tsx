import { cn } from '@/lib/utils';
import {
  removeActiveThunderstormOutlookReference,
  setActiveThunderstormOutlookReference,
  store,
} from '@/store';
import type { AIThunderstormOutlookSummaryDocument } from '@/types';
import { useStore } from '@tanstack/react-store';
import type { DateTime } from 'luxon';
import { AiOutlineFileSearch } from 'react-icons/ai';
import { CopyIcon } from '../CopyIcon';
import { buildOutlookSentence } from './utils';

export function ThunderstormOutlookItemComp({
  date,
  outlook,
}: {
  date: DateTime;
  outlook: AIThunderstormOutlookSummaryDocument['content'][number]['summary'][number];
}) {
  // One builder feeds both the on-screen line and the copied text, so they
  // always match (previously the copy text said "During afternoon" while
  // the screen said "During the afternoon").
  const sentence = buildOutlookSentence(outlook);
  const textContent = `${sentence.before}${sentence.risk}${sentence.after}`;

  return (
    <span>
      {sentence.before}
      <span className="underline lowercase">{sentence.risk}</span>
      {sentence.after}
      <span className="inline-flex px-1 gap-1 items-baseline relative top-0.5">
        <OutlookRefIcon
          date={date}
          quotes={outlook.quotes}
          keywords={outlook.keywords}
        />
        <CopyIcon content={textContent} />
      </span>
    </span>
  );
}

function OutlookRefIcon({
  date,
  quotes,
  keywords,
}: {
  date: DateTime;
  quotes: string[];
  keywords: string[];
}) {
  const activeThunderstormOutlookReference = useStore(
    store,
    (state) => state.activeThunderstormOutlookReference,
  );
  const isActive =
    activeThunderstormOutlookReference &&
    activeThunderstormOutlookReference.date === date.toISODate() &&
    activeThunderstormOutlookReference.quotes.toString() ===
      quotes.toString() &&
    activeThunderstormOutlookReference.keywords.toString() ===
      keywords.toString();

  const onClick = () => {
    if (!isActive) {
      setActiveThunderstormOutlookReference({
        quotes,
        keywords,
        date: date.toISODate()!,
      });
    } else {
      removeActiveThunderstormOutlookReference();
    }
  };

  return (
    <AiOutlineFileSearch
      className={cn(
        ' text-gray-300 cursor-pointer hover:text-yellow-500 relative top-0.5',
        isActive && 'text-yellow-500',
      )}
      size={16}
      onClick={onClick}
    />
  );
}
