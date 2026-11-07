'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { CalendarDays, Loader2, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/providers/confirm-provider';
import {
  useCreateHoliday,
  useDeleteHoliday,
  useHolidayList,
  type Holiday,
} from '@/hooks/use-holidays';
import { formatDateOnly, parseDateOnly, todayDateOnly } from '@/lib/utils/working-days';

/**
 * The workspace's holiday calendar: everybody can read it, whoever approves
 * leave can change it.
 *
 * Holidays decide how many days a leave request costs and what an attendance
 * rate is measured against, and until this existed they could only be entered
 * straight into the database — so in practice every workspace ran with none,
 * and a public holiday counted as a day everybody had failed to turn up.
 */
export function HolidaysPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const { data: holidays = [], isLoading, isError, refetch } = useHolidayList(workspaceId);
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const confirm = useConfirm();

  const [name, setName] = React.useState('');
  const [date, setDate] = React.useState<Date | undefined>(undefined);
  const [isOptional, setIsOptional] = React.useState(false);

  const today = todayDateOnly();
  const upcoming = holidays.filter((h) => h.date >= today);
  const past = holidays.filter((h) => h.date < today).reverse();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date) return;
    try {
      await createHoliday.mutateAsync({
        workspaceId,
        name: name.trim(),
        date: formatDateOnly(date),
        isOptional,
      });
      setName('');
      setDate(undefined);
      setIsOptional(false);
    } catch {
      // the mutation surfaces the reason as a toast
    }
  };

  const handleDelete = async (holiday: Holiday) => {
    const confirmed = await confirm({
      title: `Remove ${holiday.name}?`,
      description:
        'The day becomes an ordinary working day again. Approved leave across it is counted again — it costs a day — and the people concerned are told.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (!confirmed) return;
    deleteHoliday.mutate({ holidayId: holiday.id, workspaceId });
  };

  const renderRow = (holiday: Holiday) => (
    <li
      key={holiday.id}
      className="flex items-center justify-between gap-3 rounded-lg border p-3"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium" title={holiday.name}>{holiday.name}</p>
          {holiday.isOptional && <Badge variant="secondary">Optional</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {format(parseDateOnly(holiday.date), 'EEEE, MMM d, yyyy')}
        </p>
      </div>
      {canManage && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove ${holiday.name}`}
          disabled={deleteHoliday.isPending}
          onClick={() => handleDelete(holiday)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a holiday</CardTitle>
            <CardDescription>
              The office is closed on a holiday: leave is not charged for it, and nobody is
              late or absent on it. That goes for what is already on record too — leave that
              covers the date is re-counted and the day returned to the balance it came from.
              Tick Optional for a day the office stays open but people may take off.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
              <div className="space-y-2">
                <Label htmlFor="holiday-name">Name</Label>
                <Input
                  id="holiday-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Republic Day"
                  maxLength={255}
                  disabled={createHoliday.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="holiday-date">Date</Label>
                <DatePicker id="holiday-date" date={date} onSelect={setDate} placeholder="Pick a date" />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={!name.trim() || !date || createHoliday.isPending}
                  className="w-full sm:w-auto"
                >
                  {createHoliday.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add
                </Button>
              </div>
              <div className="flex items-center gap-2 sm:col-span-3">
                <Checkbox
                  id="holiday-optional"
                  checked={isOptional}
                  onCheckedChange={(checked) => setIsOptional(checked === true)}
                />
                <Label htmlFor="holiday-optional" className="font-normal">
                  Optional — the office stays open
                </Label>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holiday calendar</CardTitle>
          <CardDescription>
            {canManage
              ? 'Days this workspace does not work.'
              : 'Days this workspace does not work. Whoever approves leave keeps this list.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState
              title="Couldn't load the holiday calendar"
              description="The list of holidays could not be fetched."
              onRetry={() => refetch()}
            />
          ) : holidays.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No holidays yet"
              description={
                canManage
                  ? 'Add the days your office is closed so leave and attendance are counted correctly.'
                  : 'No holidays have been added for this workspace.'
              }
            />
          ) : (
            <div className="space-y-6">
              {upcoming.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Upcoming</h3>
                  <ul className="space-y-2">{upcoming.map(renderRow)}</ul>
                </section>
              )}
              {past.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Past</h3>
                  <ul className="space-y-2">{past.map(renderRow)}</ul>
                </section>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
