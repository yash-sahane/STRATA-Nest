import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAttendanceDto {
  @IsString() workspaceId!: string;
  @IsString() userId!: string;
  @IsString() date!: string;
  @IsString() checkInTime!: string;
  @IsOptional() @IsString() checkOutTime?: string;
  @IsOptional() @IsNumber() workHours?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() lateMinutes?: number;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isWeekend?: boolean;
  @IsOptional() @IsBoolean() isHoliday?: boolean;
}
export class UpdateAttendanceDto {
  @IsOptional() @IsString() checkOutTime?: string;
  @IsOptional() @IsNumber() workHours?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsInt() lateMinutes?: number;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() isWeekend?: boolean;
  @IsOptional() @IsBoolean() isHoliday?: boolean;
}

// Server-computed check-in/out
export class CheckInDto {
  @IsString() workspaceId!: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
}
export class CheckOutDto {
  @IsString() workspaceId!: string;
}

export class CreateHolidayDto {
  @IsString() workspaceId!: string;
  @IsString() @MaxLength(255) name!: string;
  @IsString() date!: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
  @IsOptional() @IsString() description?: string;
}
export class UpdateHolidayDto {
  @IsOptional() @IsString() @MaxLength(255) name?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
  @IsOptional() @IsString() description?: string;
}
