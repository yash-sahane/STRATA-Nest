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
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCreateUser } from '@/hooks/use-admin';
import { useAuth } from '@/components/providers/auth-provider';
import { useHasPermission } from '@/hooks/use-permissions';
import { Permission } from '@/lib/permissions';
import { parseCSV, type ParsedUser } from '@/lib/csv-parser';
import { logger } from '@/lib/logger';

interface AddMembersSectionProps {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string;
}

// Simple role mapping - maps role codes to display names
const ROLE_MAPPING: Record<string, string> = {
  MANAGER: 'Manager (Admin)',
  ASSISTANT_MANAGER: 'Assistant Manager',
  SOFTWARE_DEVELOPER: 'Software Developer',
  DEVELOPER_INTERN: 'Software Developer Intern',
  TESTER: 'Tester',
  CONTENT_ENGINEER: 'Content Engineer',
  MEMBER: 'Member',
};

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

  // Get available roles from workspace (fallback to simple role list)
  const availableRoles = React.useMemo(() => {
    // Return updated role list for selection
    return [
      { id: 'MANAGER', name: 'Manager (Admin)' },
      { id: 'ASSISTANT_MANAGER', name: 'Assistant Manager' },
      { id: 'SOFTWARE_DEVELOPER', name: 'Software Developer' },
      { id: 'DEVELOPER_INTERN', name: 'Software Developer Intern' },
      { id: 'TESTER', name: 'Tester' },
      { id: 'CONTENT_ENGINEER', name: 'Content Engineer' },
      { id: 'MEMBER', name: 'Member' },
    ];
  }, []);

  // Handle individual user form submission
  const handleIndividualSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    const roleId = formData.get('role') as string;
    const roleName = ROLE_MAPPING[roleId] || roleId;

    const userData = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      roleId,
      roleName,
      workspaceId,
      workspaceName,
      createdBy: currentUserId,
      createdByName: user?.name || 'Admin',
    };

    try {
      await createUser.mutateAsync(userData);
      toast.success('User added successfully! Welcome email sent.');

      // Reset form
      formRef.current?.reset();
      setSelectedRoleId('');
    } catch (error: any) {
      toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to add user');
      logger.error('Unexpected error', { error: error });
    } finally {
      setIsSubmitting(false);
    }
  }; // Handle CSV file selection
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    setCsvFile(file);
    setImportResults(null);

    try {
      const users = await parseCSV(file);
      setParsedUsers(users);
      toast.success(`Parsed ${users.length} users from CSV`);
    } catch (error: any) {
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
      errors: [] as Array<{ row: number; email: string; error: string }>,
    };

    for (let i = 0; i < parsedUsers.length; i++) {
      const parsedUser = parsedUsers[i];
      const roleId = parsedUser.role;
      const roleName = ROLE_MAPPING[roleId] || roleId;

      try {
        await createUser.mutateAsync({
          name: parsedUser.name,
          email: parsedUser.email,
          roleId,
          roleName,
          workspaceId,
          workspaceName,
          createdBy: currentUserId,
          createdByName: user?.name || 'Admin',
        });

        results.success++;
      } catch (error: any) {
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

    if (results.success > 0) {
      toast.success(`Successfully added ${results.success} users!`);
    }
    if (results.failed > 0) {
      toast.error(`Failed to add ${results.failed} users. Check the results below.`);
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

  // Access control - show error if user doesn't have permission
  if (!canInviteMembers) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>
            You don&apos;t have permission to add members to this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Only workspace managers can add new members. Please contact your workspace
              administrator if you need to add members.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="individual" className="space-y-6">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="individual">
          <UserPlus className="h-4 w-4 mr-2" />
          Individual User
        </TabsTrigger>
        <TabsTrigger value="bulk">
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Bulk CSV Import
        </TabsTrigger>
      </TabsList>

      {/* Individual User Tab */}
      <TabsContent value="individual">
        <Card>
          <CardHeader>
            <CardTitle>Add Individual User</CardTitle>
            <CardDescription>
              Create a new user account and add them to this workspace. They&apos;ll receive an email
              with a temporary password.
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
                    <SelectTrigger>
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
                  The user will receive an email with a temporary password. They&apos;ll be required to
                  change it on their first login.
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
                      Add User
                    </>
                  )}
                </Button>
              </div>
            </form>
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
                        DEVELOPER_INTERN, TESTER, CONTENT_ENGINEER, MEMBER
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
                <div className="border-2 border-dashed rounded-lg p-8 text-center">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <div className="space-y-2">
                    <Label
                      htmlFor="csv-upload"
                      className="text-base font-medium cursor-pointer hover:text-primary"
                    >
                      Click to upload CSV file
                    </Label>
                    <p className="text-sm text-muted-foreground">or drag and drop your file here</p>
                  </div>
                  <Input
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="hidden"
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
                  <div className="flex items-center gap-3 p-4 border rounded-lg bg-green-50 dark:bg-green-950/20">
                    <CheckCircle2 className="h-8 w-8 text-green-600" />
                    <div>
                      <div className="text-2xl font-bold">{importResults.success}</div>
                      <div className="text-sm text-muted-foreground">Successfully added</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 border rounded-lg bg-red-50 dark:bg-red-950/20">
                    <XCircle className="h-8 w-8 text-red-600" />
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
                              <TableCell className="text-red-600 text-sm">{error.error}</TableCell>
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
  );
}
