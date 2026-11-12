import { useEffect, useRef } from 'react';
import { Calendar } from '@bryntum/calendar';
import '@bryntum/calendar/calendar.css';
import '@bryntum/calendar/stockholm-light.css';
import '@bryntum/calendar/fontawesome/css/fontawesome.css';
import '@bryntum/calendar/fontawesome/css/solid.css';
import { money, type Recurring } from '../api';

// Bryntum Calendar (trial build): each steady payer's NEXT expected payments over the next 60 days, plus a red marker where one is already late.
// Every entry is an estimate from the payer's rhythm, never a confirmed payment, and the title says so.
const DAY = 86_400_000;
type Click = (i: Recurring) => void;

export function buildEvents(items: Recurring[], asOf: number, horizonDays = 60) {
  const out: Array<{ id: string; name: string; startDate: Date; endDate: Date; allDay: boolean; eventColor: string; customer: string }> = [];
  for (const i of items) {
    const label = `${i.customer} ~${money(i.typicalCents)}`;
    if (i.overdue) { out.push({ id: `${i.customer}-late`, name: `Late: ${label}`, startDate: new Date(i.nextAt), endDate: new Date(i.nextAt + DAY), allDay: true, eventColor: 'red', customer: i.customer }); continue; }
    for (let t = i.nextAt, n = 0; t <= asOf + horizonDays * DAY && n < 20; t += i.cadenceDays * DAY, n++)
      out.push({ id: `${i.customer}-${n}`, name: `Expected: ${label}`, startDate: new Date(t), endDate: new Date(t + DAY), allDay: true, eventColor: i.confidence === 'high' ? 'green' : i.confidence === 'medium' ? 'blue' : 'gray', customer: i.customer });
  }
  return out;
}

export default function BryntumCalendar({ items, asOf, onPick }: { items: Recurring[]; asOf: number; onPick: Click }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const cal = new Calendar({
      appendTo: host.current, height: 460, date: new Date(asOf), mode: 'month', readOnly: true,
      sidebar: false, modes: { day: false, year: false, agenda: {} } as never,
      events: buildEvents(items, asOf),
      listeners: { eventClick: ({ eventRecord }: { eventRecord: { data: { customer: string } } }) => { const it = items.find((x) => x.customer === eventRecord.data.customer); if (it) onPick(it); } },
    } as never);
    return () => cal.destroy();
  }, [items, asOf, onPick]);
  return <div ref={host} className="bryntum-host" aria-label="Calendar of expected payments (Bryntum Calendar)" />;
}
