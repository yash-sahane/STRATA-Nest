'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

/** Who a new workspace is for. */
export interface ManagerChoice {
  mode: 'me' | 'someone';
  name: string;
  email: string;
}

export const NO_MANAGER_CHOICE: ManagerChoice = { mode: 'me', name: '', email: '' };

/** The `manager` a create request carries, or undefined to run it yourself. */
export function managerOf(choice: ManagerChoice): { name: string; email: string } | undefined {
  return choice.mode === 'someone'
    ? { name: choice.name.trim(), email: choice.email.trim() }
    : undefined;
}

/** Whether the choice can be submitted. */
export function managerChoiceComplete(choice: ManagerChoice): boolean {
  return choice.mode === 'me' || (choice.name.trim() !== '' && /\S+@\S+\.\S+/.test(choice.email));
}

/**
 * Who runs the workspace being created.
 *
 * An administrator who created a workspace used to become its owner and a
 * Manager in it, for good: on its roster, asked to decide its leave and join
 * requests, counted as "another approver" — and, being its owner, impossible
 * to remove. Creating it for somebody else makes THEM its owner and first
 * Manager; an administrator needs no membership to look after it.
 */
export function WorkspaceManagerFields({
  value,
  onChange,
  idPrefix,
}: {
  value: ManagerChoice;
  onChange: (next: ManagerChoice) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Who will run it?</legend>
      <RadioGroup
        value={value.mode}
        onValueChange={(mode) => onChange({ ...value, mode: mode as ManagerChoice['mode'] })}
        className="space-y-2"
      >
        <div className="flex items-start gap-2">
          <RadioGroupItem value="me" id={`${idPrefix}-me`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-me`} className="font-normal leading-snug">
            <span className="font-medium">I will</span>
            <span className="block text-xs text-muted-foreground">
              You own it and manage it. You can hand it to somebody later, from Settings.
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="someone" id={`${idPrefix}-someone`} className="mt-0.5" />
          <Label htmlFor={`${idPrefix}-someone`} className="font-normal leading-snug">
            <span className="font-medium">Somebody else</span>
            <span className="block text-xs text-muted-foreground">
              They own it and are its first Manager. You stay off its team — as an administrator
              you can still open it.
            </span>
          </Label>
        </div>
      </RadioGroup>
      {value.mode === 'someone' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-manager-name`}>Their name</Label>
            <Input
              id={`${idPrefix}-manager-name`}
              value={value.name}
              autoComplete="off"
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-manager-email`}>Their email</Label>
            <Input
              id={`${idPrefix}-manager-email`}
              type="email"
              value={value.email}
              autoComplete="off"
              onChange={(e) => onChange({ ...value, email: e.target.value })}
              required
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            An account is made for them if they have none, with a temporary password they change
            when they first sign in.
          </p>
        </div>
      )}
    </fieldset>
  );
}
