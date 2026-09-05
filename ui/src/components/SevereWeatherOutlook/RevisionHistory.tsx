import { getSevereWeatherOutlookCollection } from '@/lib/mongodb';
import { useSevereWeatherOutlook } from '@/queries';
import type { SevereWeatherOutlook } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer';
import { Button } from '../ui/button';
import { ButtonGroup } from '../ui/button-group';
import { Dialog, DialogContent, DialogTrigger } from '../ui/dialog';

// Severe Weather Outlook is typically only issued once or twice a day, so
// scoping history to "today" (the old behaviour) almost never has more than
// one entry to compare. Instead this looks back over the last 5 days, using
// insertedAt (a real Date field) rather than matching on the issuedDate
// string, which is a much more reliable range query.
export function RevisionHistory() {
  const { data: outlook } = useSevereWeatherOutlook();

  const { data: revisionHistory } = useQuery({
    enabled: !!outlook,
    queryKey: ['severeWeatherOutlookRevisionHistory', outlook?.id],
    queryFn: async () => {
      return getSevereWeatherOutlookHistory({ data: { lookbackDays: 5 } });
    },
    staleTime: Infinity,
  });

  if (!revisionHistory || revisionHistory.length <= 1) {
    return <></>;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Revision History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[80vw]! h-[80vh]">
        {<DiffViewer items={revisionHistory} />}
      </DialogContent>
    </Dialog>
  );
}

export function DiffViewer({ items }: { items: SevereWeatherOutlook[] }) {
  const outlookStrs = items.map(({ outlookItems, issuedDate }) => {
    const header = `{issued}Issued: ${issuedDate}\n`;
    const result = `${header}\n ${outlookItems
      .map(({ date, outlook }) => {
        return `\n{title}${date}\n${outlook.replaceAll('\n', ' \n\n')}`;
      })
      .join('\n\n ')}`;
    return result;
  });

  const length = outlookStrs.length;
  if (length < 2) {
    return <div>No previous summary to compare.</div>;
  }

  const [oldIndex, setOldIndex] = useState(length - 2);
  const [newIndex, setNewIndex] = useState(length - 1);

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      <div className="flex pb-2">
        <div className="flex-1 flex items-center justify-center">
          <ButtonGroup>
            <Button disabled size="sm" variant="outline">
              Revision
            </Button>
            {Array.from({ length }).map((_, idx) => (
              <Button
                size="sm"
                variant={idx === oldIndex ? 'default' : 'outline'}
                key={idx}
                onClick={() => setOldIndex(idx)}
              >
                {idx + 1}
              </Button>
            ))}
          </ButtonGroup>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <ButtonGroup>
            <Button disabled size="sm" variant="outline">
              Revision
            </Button>
            {Array.from({ length }).map((_, idx) => (
              <Button
                size="sm"
                variant={idx === newIndex ? 'default' : 'outline'}
                key={idx}
                onClick={() => setNewIndex(idx)}
              >
                {idx + 1}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <ReactDiffViewer
          oldValue={outlookStrs[oldIndex]}
          newValue={outlookStrs[newIndex]}
          splitView={true}
          hideLineNumbers={true}
          compareMethod={DiffMethod.WORDS}
          showDiffOnly={false}
          renderContent={(str) => {
            if (!str) return str;
            if (str.startsWith('{title}')) {
              return <strong>{str.replace('{title}', '')}</strong>;
            } else if (str.startsWith('{issued}')) {
              return <em>{str.replace('{issued}', '')}</em>;
            } else {
              return str;
            }
          }}
        />
      </div>
    </div>
  );
}

const getSevereWeatherOutlookHistory = createServerFn()
  .inputValidator((data: { lookbackDays: number }) => data)
  .handler(
    async ({
      data,
    }): Promise<(SevereWeatherOutlook & { insertedAt: Date })[]> => {
      const collection = await getSevereWeatherOutlookCollection();
      const cutoff = new Date(
        Date.now() - data.lookbackDays * 24 * 60 * 60 * 1000,
      );
      const query = {
        insertedAt: { $gte: cutoff },
      };
      const outlooks = await collection
        .find(query, { sort: { insertedAt: 1 } })
        .toArray();

      return outlooks.map((outlook) => ({
        id: outlook._id.toString(),
        issuedDate: outlook.issuedDate,
        outlookItems: outlook.outlookItems,
        insertedAt: outlook.insertedAt,
      }));
    },
  );
