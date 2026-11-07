'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  UserPlus,
  Upload,
  Download,
  FileSpreadsheet,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { describeInviteResult, useCreateUser } from '@/hooks/use-admin';
import { TempPasswordNotice, type IssuedCredential } from '@/components/team/temp-password-notice';
import { useAuth } from '@/components/providers/auth-provider';
import { useHasPermission } from '@/hooks/use-permissions';
import { useRoleOptions } from '@/hooks/use-role-options';
import { Permission } from '@/lib/permissions';
import { parseCSV, type ParsedUser } from '@/lib/csv-parser';
import { logger } from '@/lib/logger';
import { NoAccess } from '@/components/ui/no-access';
import { InviteCodePanel, InviteRoleSelect } from '@/components/workspace/invite-code-panel';
import { cn } from '@/lib/utils';

interface AddMembersSectionProps {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string;
}

// `roleName` is the value persisted on the membership and resolved against the
// API's role matrix, so it must stay the canonical role KEY — a display label
// such as 'Manager (Admin)' matches no role and is rejected by the API.

export function AddMembersSection({
  workspaceId,
  workspaceName,
  currentUserId,
}: AddMembersSectionProps) {
  const { user } = useAuth();
  const createUser = useCreateUser();

  // Permission check - only users with INVITE_MEMBER permission can access this
  const canInviteMembers = useHasPermission(Permission.INVITE_MEMBER);

  // Form ref for resetting
  const formRef = React.useRef<HTMLFormElement>(null);

  // Accounts created on a server that cannot send mail: their temporary
  // passwords come back in the response and are shown until dismissed.
  const [issued, setIssued] = React.useState<IssuedCredential[]>([]);
  const [codeRole, setCodeRole] = React.useState('MEMBER');

  // Individual form state
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [selectedRoleId, setSelectedRoleId] = React.useState<string>('');

  // CSV upload state
  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [parsedUsers, setParsedUsers] = React.useState<ParsedUser[]>([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [processingProgress, setProcessingProgress] = React.useState(0);
  const [importResults, setImportResults] = React.useState<{
    success: number;
    failed: number;
    errors: Array<{ row: number; email: string; error: string }>;
  } | null>(null);

  // Only the roles the caller may hand out — the API refuses a role above their
  // own — and every one of them, the workspace's custom roles included.
  const { all: allRoles, grantable } = useRoleOptions(workspaceId);
  const availableRoles = React.useMemo(
    () => grantable.map((role) => ({ id: role.value, name: role.label })),
    [grantable]
  );
  // What a CSV's `role` column may name besides the built-in keys.
  const customRoleNames = React.useMemo(
    () => allRoles.filter((role) => role.custom).map((role) => role.value),
    [allRoles]
  );

  // Handle individual user form submission
  const handleIndividualSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const roleId = formData.get('role') as string;

    const userData = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      roleId,
      roleName: roleId,
      workspaceId,
      workspaceName,
      createdBy: currentUserId,
      createdByName: user?.name || 'Admin',
    };

    try {
      const result = await createUser.mutateAsync(userData);
      const { temporaryPassword } = result;
      if (temporaryPassword) {
        setIssued((prev) => [
          ...prev.filter((c) => c.email !== userData.email),
          { name: userData.name, email: userData.email, temporaryPassword },
        ]);
      }
      // Said as it happened — this used to announce "Welcome email sent" on a
      // server that had sent nothing.
      toast.success(result.invited ? 'Invitation sent' : 'User added', {
        description: describeInviteResult(result, userData.email),
      });

      // Reset form
      formRef.current?.reset();
      setSelectedRoleId('');
    } catch (error: unknown) {
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to add user');
      logger.error('Unexpected error', { error: error });
    } finally {
      setIsSubmitting(false);
    }
  }; // Handle CSV file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await takeFile(file);
  };

  // A dropped file goes through the same door as a picked one. "Drag and drop
  // your file here" had no drop handler: the browser opened the file in the tab
  // instead, and the page — temporary passwords on it included — was gone.
  const [dragging, setDragging] = React.useState(false);
  const csvInputRef = React.useRef<HTMLInputElement>(null);
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void takeFile(file);
  };

  const takeFile = async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    setCsvFile(file);
    setImportResults(null);

    try {
      const users = await parseCSV(file, customRoleNames);
      setParsedUsers(users);
      toast.success(`Parsed ${users.length} users from CSV`);
    } catch (error: unknown) {
      toast.error(
        (error instanceof Error ? error.message : String(error)) || 'Failed to parse CSV'
      );
      setCsvFile(null);
      setParsedUsers([]);
    }
  };

  // Handle bulk import
  const handleBulkImport = async () => {
    if (parsedUsers.length === 0) return;

    setIsProcessing(true);
    setProcessingProgress(0);

    const results = {
      success: 0,
      failed: 0,
      /** Of the successes, how many still have to accept. */
      invited: 0,
      errors: [] as Array<{ row: number; email: string; error: string }>,
    };
    const issuedNow: IssuedCredential[] = [];

    for (let i = 0; i < parsedUsers.length; i++) {
      const parsedUser = parsedUsers[i];
      const roleId = parsedUser.role;

      try {
        const result = await createUser.mutateAsync({
          name: parsedUser.name,
          email: parsedUser.email,
          roleId,
          roleName: roleId,
          workspaceId,
          workspaceName,
          createdBy: currentUserId,
          createdByName: user?.name || 'Admin',
        });
        if (result.temporaryPassword) {
          issuedNow.push({
            name: parsedUser.name,
            email: parsedUser.email,
            temporaryPassword: result.temporaryPassword,
          });
        }

        results.success++;
        if (result.invited) results.invited++;
      } catch (error: unknown) {
        results.failed++;
        results.errors.push({
          row: i + 2, // +2 because of header row and 0-indexing
          email: parsedUser.email,
          error: (error instanceof Error ? error.message : String(error)) || 'Unknown error',
        });
      }

      setProcessingProgress(((i + 1) / parsedUsers.length) * 100);

      // Small delay to prevent rate limiting
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    setImportResults(results);
    setIsProcessing(false);
    if (issuedNow.length > 0) {
      setIssued((prev) => [
        ...prev.filter((c) => !issuedNow.some((n) => n.email === c.email)),
        ...issuedNow,
      ]);
    }

    if (results.success > 0) {
      const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
      toast.success(
        results.invited === results.success
          ? `Invited ${people(results.success)}. They join once they accept.`
          : results.invited === 0
            ? `Added ${people(results.success)}.`
            : `Added ${people(results.success - results.invited)}; invited ${people(results.invited)}, who join once they accept.`,
        {
        description:
          issuedNow.length > 0
            ? 'No email was sent — their temporary passwords are listed at the top of this tab.'
            : undefined,
      });
    }
    if (results.failed > 0) {
      toast.error(`Could not add ${results.failed === 1 ? '1 person' : `${results.failed} people`}. Check the results below.`);
    }
  };

  // Download CSV template
  const handleDownloadTemplate = () => {
    const csvContent =
      'name,email,role\nJohn Doe,john@example.com,SOFTWARE_DEVELOPER\nJane Smith,jane@example.com,MANAGER';
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'team-members-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };

  // Reset CSV upload
  const handleResetUpload = () => {
    setCsvFile(null);
    setParsedUsers([]);
    setImportResults(null);
    setProcessingProgress(0);
  };

  // Reached by a typed URL or a stale tab: the Team page does not offer this
  // tab to somebody who cannot use it.
  if (!canInviteMembers) {
    return <NoAccess what="add people to this workspace" />;
  }

  return (
    <div className="space-y-6">
    <TempPasswordNotice credentials={issued} onDismiss={() => setIssued([])} />
    <Tabs defaultValue="individual" className="space-y-6">
      {/* Every way into the workspace, in one place. People were added from
          here, from a dialog on the Workspaces page, and — by code — from
          Settings as well; each place had its own features and its own words. */}
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="individual">
          <UserPlus className="h-4 w-4 mr-2" />
          One person
        </TabsTrigger>
        <TabsTrigger value="bulk">
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Several (CSV)
        </TabsTrigger>
        <TabsTrigger value="code">
          <KeyRound className="h-4 w-4 mr-2" />
          Invite code
        </TabsTrigger>
      </TabsList>

      {/* Individual User Tab */}
      <TabsContent value="individual">
        <Card>
          <CardHeader>
            <CardTitle>Add a person</CardTitle>
            <CardDescription>
              Create a new user account and add them to this workspace. They are emailed a
              temporary password — or, if this server cannot send email, it is shown to you here
              to pass on.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form ref={formRef} onSubmit={handleIndividualSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Full Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="John Doe"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">
                    Email Address <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="john@example.com"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">
                    Role <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    name="role"
                    required
                    disabled={isSubmitting}
                    value={selectedRoleId}
                    onValueChange={setSelectedRoleId}
                  >
                    <SelectTrigger id="role">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Everybody you add is invited: they join this workspace once they accept, from
                  their Workspaces page. A new account also has to replace its temporary password
                  the first time it signs in.
                </AlertDescription>
              </Alert>

              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding User...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Add member
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Invite code: for people who already have an account and should let
          themselves in, at the role the code grants. */}
      <TabsContent value="code">
        <Card>
          <CardHeader>
            <CardTitle>Invite code</CardTitle>
            <CardDescription>
              Somebody who already has an account enters the code on their workspace screen and
              joins at the role it grants. For somebody new, add them under One person instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="add-members-code-role">Role granted by the code</Label>
              <InviteRoleSelect
                id="add-members-code-role"
                workspaceId={workspaceId}
                value={codeRole}
                onChange={setCodeRole}
              />
            </div>
            <InviteCodePanel workspaceId={workspaceId} role={codeRole} idPrefix="add-members-code" />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Bulk CSV Import Tab */}
      <TabsContent value="bulk">
        <div className="space-y-6">
          {/* Instructions Card */}
          <Card>
            <CardHeader>
              <CardTitle>Bulk Import from CSV</CardTitle>
              <CardDescription>Upload a CSV file to add multiple users at once</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-2">
                    <p className="font-medium">CSV Format Requirements:</p>
                    <ul className="list-disc list-inside text-sm space-y-1">
                      <li>
                        Required columns:{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">name</code>,{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">email</code>,{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">role</code>
                      </li>
                      <li>
                        Valid roles: MANAGER, ASSISTANT_MANAGER, SOFTWARE_DEVELOPER,
                        DEVELOPER_INTERN, TESTER, CONTENT_ENGINEER, MEMBER, or the exact name
                        of one of this workspace&apos;s custom roles
                      </li>
                      <li>Email addresses must be unique and valid</li>
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="flex items-center gap-4">
                <Button type="button" variant="outline" onClick={handleDownloadTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
              </div>

              {/* File Upload */}
              {!csvFile && (
                <div
                  className={cn(
                    'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                    dragging && 'border-primary bg-primary/5'
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <div className="space-y-2">
                    {/* A button: the label it replaces pointed at an input
                        hidden with display:none, which a keyboard cannot reach. */}
                    <Button type="button" variant="outline" onClick={() => csvInputRef.current?.click()}>
                      Choose a CSV file
                    </Button>
                    <p className="text-sm text-muted-foreground">or drop one here</p>
                  </div>
                  <Input
                    ref={csvInputRef}
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preview & Import */}
          {csvFile && parsedUsers.length > 0 && !importResults && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Preview Users ({parsedUsers.length})</CardTitle>
                    <CardDescription>Review the users before importing</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleResetUpload}>
                    Cancel
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md border max-h-100 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedUsers.map((user, index) => (
                        <TableRow key={index}>
                          <TableCell>{user.name}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{user.role}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {isProcessing ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Processing users...</span>
                      <span>{Math.round(processingProgress)}%</span>
                    </div>
                    <Progress value={processingProgress} />
                  </div>
                ) : (
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={handleResetUpload}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleBulkImport}>
                      <Upload className="h-4 w-4 mr-2" />
                      Import {parsedUsers.length} Users
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Import Results */}
          {importResults && (
            <Card>
              <CardHeader>
                <CardTitle>Import Results</CardTitle>
                <CardDescription>Summary of the bulk import operation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex items-center gap-3 p-4 border rounded-lg bg-success/10">
                    <CheckCircle2 className="h-8 w-8 text-success-text" />
                    <div>
                      <div className="text-2xl font-bold">{importResults.success}</div>
                      <div className="text-sm text-muted-foreground">Successfully added</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 border rounded-lg bg-destructive/10">
                    <XCircle className="h-8 w-8 text-destructive-text" />
                    <div>
                      <div className="text-2xl font-bold">{importResults.failed}</div>
                      <div className="text-sm text-muted-foreground">Failed</div>
                    </div>
                  </div>
                </div>

                {importResults.errors.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Errors:</h4>
                    <div className="rounded-md border max-h-50 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-20">Row</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importResults.errors.map((error, index) => (
                            <TableRow key={index}>
                              <TableCell>{error.row}</TableCell>
                              <TableCell>{error.email}</TableCell>
                              <TableCell className="text-destructive-text text-sm">{error.error}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={handleResetUpload}>Import More Users</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </TabsContent>
    </Tabs>
    </div>
  );
}
