'use client';

import * as React from 'react';
import { Check, Copy, Download, KeyRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/** A new account whose temporary password the server handed back instead of mailing. */
export interface IssuedCredential {
  name: string;
  email: string;
  temporaryPassword: string;
}

/**
 * The temporary passwords of accounts that were just created on a server that
 * cannot send mail.
 *
 * A new account's password used to exist only in its welcome email. Where no
 * mail provider is configured that email is never sent, so the account was
 * created, the screen said "welcome email sent", and nobody could ever sign in
 * to it. The API now returns the password to whoever created the account in
 * exactly that case — and this is the only place it is ever shown, so it has to
 * be impossible to miss and easy to copy before it is dismissed.
 */
export function TempPasswordNotice({
  credentials,
  onDismiss,
}: {
  credentials: IssuedCredential[];
  onDismiss: () => void;
}) {
  const [copiedEmail, setCopiedEmail] = React.useState<string | null>(null);

  if (credentials.length === 0) return null;

  const copy = async (credential: IssuedCredential) => {
    try {
      await navigator.clipboard.writeText(credential.temporaryPassword);
      setCopiedEmail(credential.email);
      window.setTimeout(() => setCopiedEmail(null), 2000);
    } catch {
      toast.error('Could not copy automatically — select the password and copy it.');
    }
  };

  const download = () => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      'name,email,temporary_password',
      ...credentials.map((c) => [c.name, c.email, c.temporaryPassword].map(quote).join(',')),
    ];
    const url = window.URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'temporary-passwords.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const many = credentials.length > 1;

  return (
    <Alert className="border-warning/50">
      <KeyRound className="h-4 w-4" />
      <AlertTitle>
        {many
          ? `No email was sent — pass on these ${credentials.length} temporary passwords yourself`
          : 'No email was sent — pass on this temporary password yourself'}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Email is not set up on this server, so {many ? 'these people have' : 'this person has'}{' '}
          not been told anything. {many ? 'Each password is' : 'The password is'} shown here once
          and cannot be looked up later. They will be asked to choose their own the first time
          they sign in.
        </p>
        <ul className="space-y-2">
          {credentials.map((credential) => (
            <li
              key={credential.email}
              className="flex flex-col gap-2 rounded-md border bg-background p-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={credential.name}>{credential.name}</p>
                <p className="truncate text-xs text-muted-foreground" title={credential.email}>{credential.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <code className="select-all rounded bg-muted px-2 py-1 font-mono text-sm">
                  {credential.temporaryPassword}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Copy the temporary password for ${credential.name}`}
                  onClick={() => copy(credential)}
                >
                  {copiedEmail === credential.email ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedEmail === credential.email ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          {many && (
            <Button type="button" size="sm" variant="outline" onClick={download}>
              <Download className="h-4 w-4" />
              Download as CSV
            </Button>
          )}
          <Button type="button" size="sm" onClick={onDismiss}>
            I have passed {many ? 'them' : 'it'} on
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
