import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

class PushKeysDto {
  /** Client public key (P-256, 65 bytes → 87 base64url chars). */
  @IsString()
  @MaxLength(200)
  @Matches(BASE64URL)
  p256dh: string;

  /** Client auth secret (16 bytes). */
  @IsString()
  @MaxLength(50)
  @Matches(BASE64URL)
  auth: string;
}

/** The browser's `PushSubscription.toJSON()` shape. */
export class PushSubscriptionDto {
  @IsString()
  @MaxLength(1000)
  @Matches(/^https:\/\/[^\s]+$/, { message: 'endpoint must be an https URL' })
  endpoint: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  /** Sent by browsers (usually null); not stored. */
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;
}

export class PushEndpointQueryDto {
  @IsString()
  @MaxLength(1000)
  @Matches(/^https:\/\/[^\s]+$/)
  endpoint: string;
}
