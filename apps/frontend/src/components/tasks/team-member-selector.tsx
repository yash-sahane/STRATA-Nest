'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X, AlertCircle } from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  useTeamMembers,
  useMemberTaskCounts,
  getWorkloadLevel,
  ROLE_CONFIG,
} from '@/hooks/use-team';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TeamMemberSelectorProps {
  workspaceId: string;
  value?: string[]; // Array of user IDs
  onChange: (value: string[]) => void;
  placeholder?: string;
  multiSelect?: boolean;
  className?: string;
}

export function TeamMemberSelector({
  workspaceId,
  value = [],
  onChange,
  placeholder = 'Select team members...',
  multiSelect = true,
  className,
}: TeamMemberSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const { data: teamMembers = [], isLoading } = useTeamMembers(workspaceId);
  const { data: taskCounts } = useMemberTaskCounts(workspaceId);

  // Filter only active members
  const activeMembers = React.useMemo(() => {
    return teamMembers.filter((member) => member.status === 'ACTIVE');
  }, [teamMembers]);

  const selectedMembers = React.useMemo(() => {
    return activeMembers.filter((member) => value.includes(member.userId));
  }, [activeMembers, value]);

  // Sort members by workload (lowest first for optimal assignment)
  const sortedMembers = React.useMemo(() => {
    return [...activeMembers].sort((a, b) => {
      const aCount = taskCounts?.get(a.userId)?.activeTasks || 0;
      const bCount = taskCounts?.get(b.userId)?.activeTasks || 0;
      return aCount - bCount;
    });
  }, [activeMembers, taskCounts]);

  const handleSelect = (userId: string) => {
    if (multiSelect) {
      const newValue = value.includes(userId)
        ? value.filter((id) => id !== userId)
        : [...value, userId];
      onChange(newValue);
    } else {
      onChange([userId]);
      setOpen(false);
    }
  };

  const handleRemove = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(value.filter((id) => id !== userId));
  };

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* aria-label, not the inner text: ARIA gives the combobox role
              nameFrom="author" only, so the placeholder and badges inside the
              button are NOT announced as its name. Without this a screen reader
              reads it as an unnamed "combobox". */}
          <Button
            variant="outline"
            role="combobox"
            aria-label={placeholder}
            aria-expanded={open}
            className={cn('w-full justify-between', className)}
          >
            <div className="flex flex-wrap gap-1 flex-1">
              {selectedMembers.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : (
                selectedMembers.map((member) => (
                  <Badge key={member.userId} variant="secondary" className="gap-1 pr-1">
                    <Avatar className="h-4 w-4">
                      <AvatarImage src={member.avatar} alt={member.name} />
                      <AvatarFallback className="text-xs">
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="max-w-[100px] truncate">{member.name}</span>
                    {multiSelect && (
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-destructive-text"
                        onClick={(e) => handleRemove(member.userId, e)}
                      />
                    )}
                  </Badge>
                ))
              )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[450px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search team members..." />
            <CommandEmpty>{isLoading ? 'Loading...' : 'No team members found.'}</CommandEmpty>
            <ScrollArea className="max-h-[300px]">
              <CommandGroup>
                {sortedMembers.map((member) => {
                  const isSelected = value.includes(member.userId);
                  const memberCounts = taskCounts?.get(member.userId);
                  const activeTasks = memberCounts?.activeTasks || 0;
                  const overdueTasks = memberCounts?.overdueTasks || 0;
                  const workload = getWorkloadLevel(activeTasks);

                  return (
                    <CommandItem
                      key={member.userId}
                      value={`${member.name} ${member.email}`}
                      onSelect={() => handleSelect(member.userId)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'opacity-50 [&_svg]:invisible'
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </div>
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={member.avatar} alt={member.name} />
                          <AvatarFallback className="text-xs">
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{member.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {member.email}
                          </div>
                        </div>
                        {/* Workload indicator */}
                        <div className="flex items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className={cn('text-xs shrink-0 gap-1', workload.color)}
                              >
                                {activeTasks} tasks
                                {overdueTasks > 0 && (
                                  <AlertCircle className="h-3 w-3 text-red-500" />
                                )}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <div className="text-xs space-y-1">
                                <p>
                                  <strong>{workload.label}</strong>
                                </p>
                                <p>Active: {activeTasks} tasks</p>
                                {overdueTasks > 0 && (
                                  <p className="text-red-400">Overdue: {overdueTasks}</p>
                                )}
                                <p>Completed: {memberCounts?.completedTasks || 0}</p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {ROLE_CONFIG[member.role].label}
                          </Badge>
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </ScrollArea>
          </Command>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
