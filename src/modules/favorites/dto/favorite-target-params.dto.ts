import { IsEnum, IsUUID } from 'class-validator';
import { favorite_type } from '@prisma/client';

export class FavoriteTargetParamsDto {
  @IsEnum(favorite_type)
  entityType: favorite_type;

  @IsUUID()
  entityId: string;
}
