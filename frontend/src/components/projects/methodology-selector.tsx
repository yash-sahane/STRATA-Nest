"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Calendar, AlertTriangle } from "lucide-react";
import type { ProjectMethodology } from "@/types";

interface MethodologySelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentMethodology?: ProjectMethodology;
  onSelect: (methodology: ProjectMethodology) => void;
  isChanging?: boolean;
}

const methodologies = [
  {
    value: "SCRUM" as ProjectMethodology,
    label: "Scrum",
    icon: Calendar,
    description: "Time-boxed sprints with planning and retrospectives",
    features: [
      "Sprint planning and tracking",
      "Burndown charts",
      "Sprint backlog",
      "Velocity metrics",
      "Sprint retrospectives",
    ],
    bestFor: "Teams with predictable release cycles and defined goals",
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
];

export function MethodologySelector({
  open,
  onOpenChange,
  currentMethodology,
  onSelect,
  isChanging = false,
}: MethodologySelectorProps) {
  const [selected, setSelected] = React.useState<ProjectMethodology>(
    currentMethodology || "SCRUM"
  );

  React.useEffect(() => {
    if (currentMethodology) {
      setSelected(currentMethodology);
    }
  }, [currentMethodology]);

  const handleConfirm = () => {
    onSelect(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isChanging ? "Change Project Methodology" : "Select Project Methodology"}
          </DialogTitle>
          <DialogDescription>
            {isChanging ? (
              <span className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                <AlertTriangle className="h-4 w-4" />
                Changing methodology will affect how your board and workflows operate.
              </span>
            ) : (
              "Choose how you want to manage this project. This defines your board structure and workflow."
            )}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selected}
          onValueChange={(value) => setSelected(value as ProjectMethodology)}
          className="grid gap-4"
        >
          {methodologies.map((methodology) => {
            const Icon = methodology.icon;
            const isSelected = selected === methodology.value;

            return (
              <Card
                key={methodology.value}
                className={`relative cursor-pointer transition-all ${isSelected
                  ? `${methodology.borderColor} border-2 ${methodology.bgColor}`
                  : "border hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                onClick={() => setSelected(methodology.value)}
              >
                <div className="p-6">
                  <div className="flex items-start gap-4">
                    <RadioGroupItem
                      value={methodology.value}
                      id={methodology.value}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <Icon className={`h-6 w-6 ${methodology.color}`} />
                        <Label
                          htmlFor={methodology.value}
                          className="text-lg font-semibold cursor-pointer"
                        >
                          {methodology.label}
                        </Label>
                        {isSelected && (
                          <CheckCircle2 className="h-5 w-5 text-green-600 ml-auto" />
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        {methodology.description}
                      </p>

                      <div className="space-y-2">
                        <p className="text-sm font-medium">Key Features:</p>
                        <ul className="grid gap-1.5 text-sm text-muted-foreground">
                          {methodology.features.map((feature, index) => (
                            <li key={index} className="flex items-center gap-2">
                              <div className="h-1.5 w-1.5 rounded-full bg-current" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className={`pt-3 border-t ${isSelected ? "border-current" : ""}`}>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Best for:</span> {methodology.bestFor}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </RadioGroup>

        {isChanging && (
          <div className="rounded-md bg-orange-50 dark:bg-orange-950 p-4 border border-orange-200 dark:border-orange-800">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm space-y-1">
                <p className="font-medium text-orange-900 dark:text-orange-100">
                  Important: Methodology Change Impact
                </p>
                <ul className="text-orange-700 dark:text-orange-300 space-y-0.5">
                  <li>• Your board layout and columns will be updated</li>
                  <li>• Existing tasks will remain but may need reorganization</li>
                  <li>• Sprint-specific features will be enabled or disabled</li>
                  <li>• Team members will see the updated workflow immediately</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selected}>
            {isChanging ? "Change Methodology" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
