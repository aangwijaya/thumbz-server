import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import {
  CurrentUser,
  CurrentUser as CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { FavoriteTargetParamsDto } from './dto/favorite-target-params.dto';
import { Favorite, FavoritesService } from './favorites.service';

@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload): Promise<{ data: Favorite[] }> {
    return this.favoritesService.list(user.sub);
  }

  @Put(':entityType/:entityId')
  add(
    @Param() params: FavoriteTargetParamsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: Favorite }> {
    return this.favoritesService.add(
      user.sub,
      params.entityType,
      params.entityId,
    );
  }

  @Delete(':entityType/:entityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param() params: FavoriteTargetParamsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.favoritesService.remove(
      user.sub,
      params.entityType,
      params.entityId,
    );
  }
}
