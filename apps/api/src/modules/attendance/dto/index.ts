import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsStrictBoolean } from '@strata/common';

/** Closed set of persisted attendance statuses (mirrors determineAttendanceStatus). */
export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'HALF_DAY',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
];

export class CreateAttendanceDto {
  @IsString() workspaceId!: string;
  /** Optional: the row is stamped with the caller's id unless they are an HR manager. */
  @IsOptional() @IsString() userId?: string;
  @IsDateString() date!: string;
  @IsDateString() checkInTime!: string;
  @IsOptional() @IsDateString() checkOutTime?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(24) workHours?: number;
  @IsOptional() @IsIn(ATTENDANCE_STATUSES) status?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1440) lateMinutes?: number;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isWeekend?: boolean;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isHoliday?: boolean;
}
export class UpdateAttendanceDto {
  @IsOptional() @IsDateString() checkOutTime?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(24) workHours?: number;
  @IsOptional() @IsIn(ATTENDANCE_STATUSES) status?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1440) lateMinutes?: number;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isWeekend?: boolean;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isHoliday?: boolean;
}

// Server-computed check-in/out
export class CheckInDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
}
export class CheckOutDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() notes?: string;
}

export class CreateHolidayDto {
  @IsString() workspaceId!: string;
  @IsString() @MaxLength(255) name!: string;
  @IsDateString() date!: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isOptional?: boolean;
  @IsOptional() @IsString() description?: string;
}
export class UpdateHolidayDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsStrictBoolean() @IsBoolean() isOptional?: boolean;
  @IsOptional() @IsString() description?: string;
}
