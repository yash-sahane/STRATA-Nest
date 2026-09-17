'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sparkles, FileText, CheckCircle2, Loader2, Upload, Target, ListTodo } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  generateProjectHierarchyUnified,
  type GeneratedHierarchy,
  type DocumentAnalysis,
} from '@/lib/ai-generator';

const formSchema = z.object({
  documentText: z
    .string()
    .min(100, 'Please provide at least 100 characters for strong and accurate generation')
    .refine(
      (text) => text.trim().length >= 100,
      'Meaningful content must be at least 100 characters (spaces excluded)'
    ),
});

type FormData = z.infer<typeof formSchema>;

/** A generated node before it has been checked — every field is really unknown. */
type RawNode = Record<string, unknown>;

/**
 * One value the preview drops straight into JSX. Anything that is not a string
 * or a number throws "Objects are not valid as a React child" from the RENDER
 * pass, which is outside onSubmit's try/catch and therefore fatal to the route.
 */
const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/**
 * A number the API stores in a numeric column, so "8" has to become 8 — a
 * string reaches Prisma as a Float and fails the whole bulk-save.
 */
const num = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Elements that are actually objects. The model sometimes emits a `null` (or a
 * bare string) where a node belongs, and `node.title` throws on it — inside
 * this normalizer that is only a "Generation Failed" toast, but a survivor
 * reaching the preview kills the route. Dropping the element loses nothing:
 * there was no node there to show.
 */
const nodes = (value: unknown): RawNode[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is RawNode => typeof v === 'object' && v !== null && !Array.isArray(v)
      )
    : [];

/** Leaf arrays are rendered one item per <li>/<Badge>, so they must be scalars. */
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter(Boolean) : [];

/**
 * A cross-reference, kept EXACTLY as the model wrote it when it is already a
 * scalar. bulk-save's resolver reads a number as an array index but a string as
 * a title first, so flattening 2 to "2" could re-point the link at an epic that
 * merely happens to be named "2". Anything non-scalar is dropped: it can only
 * resolve to null anyway.
 */
const isRef = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number';
const refs = (value: unknown): (string | number)[] =>
  Array.isArray(value) ? value.filter(isRef) : [];

/**
 * The prompt's JSON schema is advisory, not enforced: the model regularly drops
 * an optional array on an individual node even when every top-level section is
 * perfect, and just as regularly answers with the wrong TYPE for a field.
 * ai-generator only defends the TOP-LEVEL arrays, so one missing
 * `acceptanceCriteria` / `labels` / `milestones` — or one null element, or one
 * object where a title belongs — threw inside this dialog's render, which
 * unmounts the dialog AND replaces the whole /requirements route with the error
 * boundary, throwing away a generation the user already paid ~25s and one API
 * call for. This is the single arrival point for model output: make the shape
 * true here rather than guarding every read site in the preview.
 *
 * Cross-references (`functionalRequirementIds`, `epicId`, `parentId`) are the
 * one thing NOT rewritten: bulk-save resolves them to rebuild the epic→FR and
 * task→epic links, so they pass through exactly as the model wrote them.
 */
function normalizeGenerated(raw: GeneratedHierarchy): GeneratedHierarchy {
  const g = (raw ?? {}) as Partial<GeneratedHierarchy>;
  const normalized = {
    ...g,
    // Every field here is rendered unconditionally in the preview header.
    analysis: {
      summary: str(g.analysis?.summary),
      complexity: str(g.analysis?.complexity),
      estimatedDuration: str(g.analysis?.estimatedDuration),
      // Displayed, never computed with — and the model answers "3-5" as often
      // as 4, so keep whatever it said rather than rounding it away to 0.
      recommendedTeamSize: str(g.analysis?.recommendedTeamSize),
    },
    clientRequirements: nodes(g.clientRequirements).map((req) => ({
      ...req,
      title: str(req.title),
      clientName: str(req.clientName),
      description: str(req.description),
      priority: str(req.priority),
    })),
    functionalRequirements: nodes(g.functionalRequirements).map((req) => ({
      ...req,
      title: str(req.title),
      description: str(req.description),
      type: str(req.type),
      priority: str(req.priority),
      complexity: str(req.complexity),
      parentId: str(req.parentId),
      acceptanceCriteria: strings(req.acceptanceCriteria),
      businessRules: strings(req.businessRules),
    })),
    epics: nodes(g.epics).map((epic) => ({
      ...epic,
      name: str(epic.name),
      description: str(epic.description),
      color: str(epic.color),
      startDate: str(epic.startDate),
      endDate: str(epic.endDate),
      functionalRequirementIds: refs(epic.functionalRequirementIds),
    })),
    tasks: nodes(g.tasks).map((task) => ({
      ...task,
      title: str(task.title),
      description: str(task.description),
      priority: str(task.priority),
      epicId: isRef(task.epicId) ? task.epicId : undefined,
      estimatedHours: num(task.estimatedHours),
      labels: strings(task.labels),
    })),
    timeline: {
      projectDuration: str(g.timeline?.projectDuration) || str(g.analysis?.estimatedDuration),
      milestones: nodes(g.timeline?.milestones).map((milestone) => ({
        name: str(milestone.name),
        date: str(milestone.date),
        description: str(milestone.description),
      })),
    },
  };
  // The declared type was always a lie — ai-generator hands back a bare
  // JSON.parse of the model's answer. It is true of `normalized` by
  // construction, but the enum-shaped fields ("HIGH", "FUNCTIONAL", ...) are
  // whatever the model typed, so re-assert it here rather than pretend a
  // per-field cast validated them; the API upper-cases and defaults them.
  return normalized as unknown as GeneratedHierarchy;
}

interface AIGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectCode: string;
  workspaceId: string;
  userId: string;
  onGenerated: (data: GeneratedHierarchy) => void;
}

type GenerationStep = 'input' | 'generating' | 'preview' | 'saving';

export function AIGenerateDialog({
  open,
  onOpenChange,
  projectId,
  projectCode,
  workspaceId,
  userId,
  onGenerated,
}: AIGenerateDialogProps) {
  const [step, setStep] = React.useState<GenerationStep>('input');
  const [progress, setProgress] = React.useState(0);
  const [generatedData, setGeneratedData] = React.useState<GeneratedHierarchy | null>(null);
  const [analysis, setAnalysis] = React.useState<DocumentAnalysis | null>(null);
  const [saveProgress, setSaveProgress] = React.useState(0);
  /** Stable per generated tree: makes an accidental second "Confirm & Save All" a no-op server-side. */
  const [saveKey, setSaveKey] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      documentText: '',
    },
  });

  // Derived, not duplicated state: file upload and form.reset() both go through
  // setValue, which never reached a separate charCount counter.
  const charCount = form.watch('documentText')?.length ?? 0;

  /**
   * The planned timeline, but only when it is genuinely a SECOND answer.
   *
   * `timeline.projectDuration` is seeded from `analysis.estimatedDuration`
   * whenever the model omits it — in ai-generator when the whole `timeline`
   * block is missing, and in normalizeGenerated when only the field is — so the
   * two are usually the identical string, and the preview header printed it
   * twice under two badges that both read "Duration:". They are different
   * claims only when the model answers both: the estimate is how long the
   * DOCUMENT looks like it needs, the timeline is the span the generated
   * milestones actually cover. So label them apart, and drop the second badge
   * when it would only echo the first.
   */
  const plannedTimeline = React.useMemo(() => {
    if (!generatedData || !analysis) return '';
    const planned = str(generatedData.timeline.projectDuration).trim();
    const estimate = str(analysis.estimatedDuration).trim();
    return planned.toLowerCase() === estimate.toLowerCase() ? '' : planned;
  }, [generatedData, analysis]);

  /**
   * The handle for whichever progress timer is running.
   *
   * A ref rather than a local: `clearInterval` has to be reachable from the
   * unmount effect below and from `finally`, and a second attempt must not be
   * able to start a second timer while the first is still ticking.
   */
  const progressTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const stopProgressTimer = React.useCallback(() => {
    if (progressTimer.current !== null) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const startProgressTimer = React.useCallback(
    (advance: () => void, everyMs: number) => {
      // Never two at once.
      stopProgressTimer();
      progressTimer.current = setInterval(advance, everyMs);
    },
    [stopProgressTimer],
  );

  // Closing the dialog mid-generation used to leave the timer running, calling
  // setProgress on an unmounted component every 800ms for the life of the page.
  React.useEffect(() => stopProgressTimer, [stopProgressTimer]);

  const resetDialog = () => {
    // Nothing should still be ticking once the dialog is put away.
    stopProgressTimer();
    setStep('input');
    setProgress(0);
    setGeneratedData(null);
    setAnalysis(null);
    setSaveKey(null);
    form.reset();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Only these are actually readable: PDFs go through /api/parse-pdf and the
    // rest are read as plain text. .docx used to be offered here too, but
    // nothing unzips it — `file.text()` handed the raw archive bytes to the
    // model as the "requirements document".
    const validTypes = ['text/plain', 'text/markdown', 'application/pdf'];
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    // Some platforms report an empty `type`, so the extension has to count too.
    if (
      !validTypes.includes(file.type) &&
      !name.endsWith('.txt') &&
      !name.endsWith('.md') &&
      !isPdf
    ) {
      toast({
        title: 'Invalid File Type',
        description: 'Please upload a .txt, .md, or .pdf file',
        variant: 'destructive',
      });
      // Let the same file be re-picked after a correction; without this the
      // input keeps its value and the next identical choice fires no change.
      event.target.value = '';
      return;
    }

    try {
      let text = '';

      if (isPdf) {
        // Handle PDF files properly using API route
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          // The route answers 401 (session expired) and 413 (too large) with a
          // reason; "Failed to parse PDF" hid both.
          throw new Error(data?.error || 'Failed to parse PDF');
        }
        text = data?.text ?? '';
      } else {
        // Handle text files
        text = await file.text();
      }

      form.setValue('documentText', text);
      toast({
        title: 'File Loaded',
        description: `${file.name} has been loaded successfully (${text.length} characters)`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description:
          (error instanceof Error ? error.message : String(error)) || 'Failed to read file',
        variant: 'destructive',
      });
    } finally {
      // Re-picking the same file after a failure must re-fire onChange.
      event.target.value = '';
    }
  };

  const onSubmit = async (values: FormData) => {
    try {
      // Single AI call that generates everything at once (saves tokens!)
      setStep('generating');
      setProgress(20);

      // Simulate progress while AI processes. Cleared in `finally` below: this
      // was cleared here only, so any throw — including the generation timeout —
      // left it ticking forever.
      startProgressTimer(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 800);

      const generated = normalizeGenerated(
        await generateProjectHierarchyUnified(values.documentText, workspaceId)
      );

      stopProgressTimer();
      setProgress(100);

      // Extract analysis from unified response
      setAnalysis(generated.analysis);
      setGeneratedData(generated);
      setSaveKey(crypto.randomUUID());

      // Show preview
      setStep('preview');

      toast({
        title: 'Success!',
        description: 'AI has generated your project structure',
      });
    } catch (error: any) {
      toast({
        title: 'Generation Failed',
        description:
          (error instanceof Error ? error.message : String(error)) ||
          'Failed to generate project structure',
        variant: 'destructive',
      });
      setStep('input');
      setProgress(0);
    } finally {
      // Every path, not just the successful one.
      stopProgressTimer();
    }
  };

  const handleConfirmGeneration = async () => {
    if (!generatedData || !projectId || !workspaceId || !userId) return;

    setStep('saving');
    setSaveProgress(10);

    try {
      // Simulate progress during API call. Same leak as the generate step: this
      // was cleared on the happy path alone.
      startProgressTimer(() => {
        setSaveProgress((prev) => Math.min(prev + 10, 90));
      }, 500);

      const response = await fetch('/api/bulk-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Retry-safe: the server returns the first response for a repeated key
          // instead of building a second copy of the whole tree.
          ...(saveKey ? { 'Idempotency-Key': saveKey } : {}),
        },
        body: JSON.stringify({
          generated: generatedData,
          projectId,
          projectCode,
          workspaceId,
        }),
      });

      stopProgressTimer();
      setSaveProgress(100);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || data?.error || 'Failed to save generated data');
      }

      // Call onGenerated callback for any additional handling
      onGenerated(generatedData);

      // The API response is FLAT ({ success, clientRequirements, ... }) — there
      // is no `result` wrapper, and reading one made every SUCCESSFUL save
      // report 'Save Failed' and invite a duplicating retry.
      toast({
        title: 'Successfully Saved!',
        description: `Added ${data.clientRequirements?.length ?? 0} client requirements, ${data.functionalRequirements?.length ?? 0} FRs, ${data.epics?.length ?? 0} epics, and ${data.tasks?.length ?? 0} tasks`,
      });

      // Refetch instead of window.location.reload(): a reload destroys the
      // document — and sonner's toast store — in the same tick as the toast.
      for (const key of [
        ['client-requirements', projectId],
        ['functional-requirements', projectId],
        ['epics', projectId],
        ['tasks', projectId],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }

      // Close dialog and reset
      onOpenChange(false);
      resetDialog();
    } catch (error: any) {
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save generated data',
        variant: 'destructive',
      });
      // Go back to preview on error so user can retry
      setStep('preview');
      setSaveProgress(0);
    } finally {
      // A failed bulk save left this ticking at 500ms for the life of the page.
      stopProgressTimer();
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
    resetDialog();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) resetDialog();
        onOpenChange(open);
      }}
    >
      <DialogContent size="3xl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            AI-Powered Project Generation
          </DialogTitle>
          <DialogDescription>
            Paste your requirements or upload a document, and AI will generate the complete project
            structure
          </DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* File Upload */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Upload Document (Optional)
                  </CardTitle>
                  <CardDescription>
                    Upload a .txt, .md, .pdf, or .docx file containing requirements
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* The control had no label of any kind, so tabbing the dialog
                      reached a completely unnamed file-upload button. The
                      sr-only <label> names it and the description is wired up
                      so the accepted formats are announced with it. */}
                  <label htmlFor="ai-generate-file" className="sr-only">
                    Upload a requirements document
                  </label>
                  <input
                    id="ai-generate-file"
                    type="file"
                    accept=".txt,.md,.pdf"
                    aria-describedby="ai-generate-file-hint"
                    onChange={handleFileUpload}
                    className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                  />
                  <p id="ai-generate-file-hint" className="sr-only">
                    Accepted formats: .txt, .md, .pdf
                  </p>
                </CardContent>
              </Card>

              {/* Text Input */}
              <FormField
                control={form.control}
                name="documentText"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Requirements Document *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Paste your client requirements here...

Example:
We need a mobile app for our e-commerce business that allows customers to browse products, add to cart, make payments, and track orders. The app should support both iOS and Android platforms..."
                        className="min-h-[300px] font-mono text-sm"
                        {...field}
                      />
                    </FormControl>
                    <div className="flex justify-between items-start">
                      <FormDescription>
                        Minimum 100 characters for strong and accurate generation. Include specific
                        details about features, requirements, and business goals.
                      </FormDescription>
                      <span
                        className={`text-sm font-medium ${charCount >= 100 ? 'text-green-700 dark:text-green-400' : charCount >= 50 ? 'text-yellow-700 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {charCount} / 100
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Actions */}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button type="submit">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate with AI
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}

        {step === 'generating' && (
          <div className="space-y-6 py-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <Loader2 className="h-16 w-16 text-purple-500 animate-spin" />
                <Sparkles className="h-8 w-8 text-yellow-700 dark:text-yellow-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">Generating Project Structure...</h3>
                <p className="text-sm text-muted-foreground">
                  AI is analyzing and creating requirements, epics, and tasks in one pass
                </p>
              </div>
              <div className="w-full max-w-md space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">{progress}%</p>
              </div>
            </div>
          </div>
        )}

        {step === 'saving' && (
          <div className="space-y-6 py-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <Loader2 className="h-16 w-16 text-green-700 dark:text-green-500 animate-spin" />
                <CheckCircle2 className="h-8 w-8 text-green-300 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold">Saving to Database...</h3>
                <p className="text-sm text-muted-foreground">
                  Creating {generatedData?.clientRequirements.length || 0} client requirements,{' '}
                  {generatedData?.functionalRequirements.length || 0} FRs,{' '}
                  {generatedData?.epics.length || 0} epics, and {generatedData?.tasks.length || 0}{' '}
                  tasks
                </p>
              </div>
              <div className="w-full max-w-md space-y-2">
                <Progress value={saveProgress} className="h-2" />
                <p className="text-xs text-center text-muted-foreground">{saveProgress}%</p>
              </div>
            </div>
          </div>
        )}

        {step === 'preview' && generatedData && analysis && (
          <div className="space-y-6">
            {/* Analysis Summary */}
            <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-700 dark:text-green-500" />
                  Analysis Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{analysis.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Complexity: {analysis.complexity}</Badge>
                  <Badge variant="outline">
                    Estimated Duration: {analysis.estimatedDuration}
                  </Badge>
                  <Badge variant="outline">
                    Team Size: {analysis.recommendedTeamSize} developers
                  </Badge>
                  {plannedTimeline && (
                    <Badge variant="outline">Planned Timeline: {plannedTimeline}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Generated Content */}
            <Tabs defaultValue="client-reqs" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="client-reqs">
                  <FileText className="h-4 w-4 mr-1" />
                  Client ({generatedData.clientRequirements.length})
                </TabsTrigger>
                <TabsTrigger value="functional-reqs">
                  <ListTodo className="h-4 w-4 mr-1" />
                  Functional ({generatedData.functionalRequirements.length})
                </TabsTrigger>
                <TabsTrigger value="epics">
                  <Target className="h-4 w-4 mr-1" />
                  Epics ({generatedData.epics.length})
                </TabsTrigger>
                <TabsTrigger value="tasks">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Tasks ({generatedData.tasks.length})
                </TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
              </TabsList>

              <ScrollArea className="h-[400px] mt-4">
                <TabsContent value="client-reqs" className="space-y-3">
                  {generatedData.clientRequirements.map((req, idx) => (
                    <Card key={idx}>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center justify-between">
                          {req.title}
                          <Badge>{req.priority}</Badge>
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Client: {req.clientName}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">{req.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="functional-reqs" className="space-y-3">
                  {generatedData.functionalRequirements.map((req, idx) => (
                    <Card key={idx}>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center justify-between">
                          {req.title}
                          <div className="flex gap-1">
                            <Badge variant="outline">{req.type}</Badge>
                            <Badge>{req.priority}</Badge>
                          </div>
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Complexity: {req.complexity}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-sm text-muted-foreground">{req.description}</p>
                        {req.acceptanceCriteria.length > 0 && (
                          <div className="text-xs space-y-1">
                            <div className="font-medium">Acceptance Criteria:</div>
                            <ul className="list-disc list-inside space-y-0.5">
                              {req.acceptanceCriteria.map((criteria, i) => (
                                <li key={i}>{criteria}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="epics" className="space-y-3">
                  {generatedData.epics.map((epic, idx) => (
                    <Card key={idx}>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: epic.color }}
                          />
                          {epic.name}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {epic.startDate && epic.endDate && `${epic.startDate} → ${epic.endDate}`}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground">{epic.description}</p>
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="tasks" className="space-y-3">
                  {generatedData.tasks.map((task, idx) => (
                    <Card key={idx}>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center justify-between">
                          {task.title}
                          <div className="flex gap-1">
                            <Badge variant="outline">{task.estimatedHours}h</Badge>
                            <Badge>{task.priority}</Badge>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <p className="text-sm text-muted-foreground">{task.description}</p>
                        {task.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {task.labels.map((label, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {label}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="timeline" className="space-y-3">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Project Timeline</CardTitle>
                      <CardDescription>
                        Duration: {generatedData.timeline.projectDuration}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {generatedData.timeline.milestones.map((milestone, idx) => (
                        <div key={idx} className="flex gap-3 items-start">
                          <div className="w-2 h-2 rounded-full bg-purple-500 mt-2" />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{milestone.name}</div>
                            <div className="text-xs text-muted-foreground">{milestone.date}</div>
                            <div className="text-sm text-muted-foreground mt-1">
                              {milestone.description}
                            </div>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </TabsContent>
              </ScrollArea>
            </Tabs>

            {/* Actions */}
            <div className="flex justify-between items-center pt-4 border-t">
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep('input')}>
                  Regenerate
                </Button>
                <Button type="button" variant="success" onClick={handleConfirmGeneration}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Confirm & Save All
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
