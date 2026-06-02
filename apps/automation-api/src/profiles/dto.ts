import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class LaunchDefaultsDto {
  @IsOptional()
  @IsBoolean()
  headless?: boolean;

  @IsOptional()
  @IsBoolean()
  geoip?: boolean;
}

export class CreateProfileDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsOptional()
  @IsString()
  proxy?: string | null;

  @IsOptional()
  @IsString()
  fingerprintSeed?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => LaunchDefaultsDto)
  launchDefaults?: LaunchDefaultsDto;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @IsOptional()
  @IsString()
  proxy?: string | null;

  @IsOptional()
  @IsString()
  fingerprintSeed?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => LaunchDefaultsDto)
  launchDefaults?: LaunchDefaultsDto;
}
