'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const [charCount, setCharCount] = React.useState(0);
  const [saveProgress, setSaveProgress] = React.useState(0);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      documentText: '',
    },
  });

  const resetDialog = () => {
    setStep('input');
    setProgress(0);
    setGeneratedData(null);
    setAnalysis(null);
    form.reset();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file type
    const validTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (
      !validTypes.includes(file.type) &&
      !file.name.endsWith('.txt') &&
      !file.name.endsWith('.md')
    ) {
      toast({
        title: 'Invalid File Type',
        description: 'Please upload a .txt, .md, .pdf, or .docx file',
        variant: 'destructive',
      });
      return;
    }

    try {
      let text = '';

      if (file.type === 'application/pdf') {
        // Handle PDF files properly using API route
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Failed to parse PDF');
        }

        const data = await response.json();
        text = data.text;
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
    }
  };

  const onSubmit = async (values: FormData) => {
    try {
      // Single AI call that generates everything at once (saves tokens!)
      setStep('generating');
      setProgress(20);

      // Simulate progress while AI processes
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 800);

      const generated = await generateProjectHierarchyUnified(values.documentText);

      clearInterval(progressInterval);
      setProgress(100);

      // Extract analysis from unified response
      setAnalysis(generated.analysis);
      setGeneratedData(generated);

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
    }
  };

  const handleConfirmGeneration = async () => {
    if (!generatedData || !projectId || !workspaceId || !userId) return;

    setStep('saving');
    setSaveProgress(10);

    try {
      // Simulate progress during API call
      const progressInterval = setInterval(() => {
        setSaveProgress((prev) => Math.min(prev + 10, 90));
      }, 500);

      const response = await fetch('/api/bulk-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          generated: generatedData,
          projectId,
          projectCode,
          workspaceId,
          userId,
        }),
      });

      clearInterval(progressInterval);
      setSaveProgress(100);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save generated data');
      }

      // Call onGenerated callback for any additional handling
      onGenerated(generatedData);

      // Show success toast with counts
      toast({
        title: 'Successfully Saved!',
        description: `Added ${data.result.clientRequirements.length} client requirements, ${data.result.functionalRequirements.length} FRs, ${data.result.epics.length} epics, and ${data.result.tasks.length} tasks`,
      });

      // Close dialog and reset
      onOpenChange(false);
      resetDialog();

      // Refresh the page to show new data
      window.location.reload();
    } catch (error: any) {
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save generated data',
        variant: 'destructive',
      });
      // Go back to preview on error so user can retry
      setStep('preview');
      setSaveProgress(0);
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
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
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
                  <input
                    type="file"
                    accept=".txt,.md,.pdf,.docx"
                    onChange={handleFileUpload}
                    className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                  />
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
                        onChange={(e) => {
                          field.onChange(e);
                          setCharCount(e.target.value.length);
                        }}
                      />
                    </FormControl>
                    <div className="flex justify-between items-start">
                      <FormDescription>
                        Minimum 100 characters for strong and accurate generation. Include specific
                        details about features, requirements, and business goals.
                      </FormDescription>
                      <span
                        className={`text-sm font-medium ${charCount >= 100 ? 'text-green-600' : charCount >= 50 ? 'text-yellow-600' : 'text-red-600'}`}
                      >
                        {charCount} / 100
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-purple-600 hover:bg-purple-700">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate with AI
                </Button>
              </div>
            </form>
          </Form>
        )}

        {step === 'generating' && (
          <div className="space-y-6 py-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <Loader2 className="h-16 w-16 text-purple-500 animate-spin" />
                <Sparkles className="h-8 w-8 text-yellow-500 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
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
                <Loader2 className="h-16 w-16 text-green-500 animate-spin" />
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
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  Analysis Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{analysis.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Complexity: {analysis.complexity}</Badge>
                  <Badge variant="outline">Duration: {analysis.estimatedDuration}</Badge>
                  <Badge variant="outline">
                    Team Size: {analysis.recommendedTeamSize} developers
                  </Badge>
                  <Badge variant="outline">
                    Duration: {generatedData.timeline.projectDuration}
                  </Badge>
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
                <Button
                  type="button"
                  onClick={handleConfirmGeneration}
                  className="bg-green-600 hover:bg-green-700"
                >
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
