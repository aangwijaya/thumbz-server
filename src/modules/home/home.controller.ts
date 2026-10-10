import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { HomeQueryDto } from './dto/home-query.dto';
import { HomePayload, HomeService } from './home.service';
import { Cached } from '../../infra/cache/cached.decorator';
import { CacheTags } from '../../infra/cache/cache-tags';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @OptionalAuth()
  @Cached({
    ttl: 30,
    perUser: true,
    tags: () => [CacheTags.home, CacheTags.catalog],
  })
  @Get()
  getHome(
    @CurrentUser() user: { sub: string } | undefined,
    @Query() query: HomeQueryDto,
  ): Promise<{ data: HomePayload }> {
    return this.homeService.getHome(user?.sub, query.tournament_id);
  }
}
