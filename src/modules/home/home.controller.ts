import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { HomePayload, HomeService } from './home.service';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @OptionalAuth()
  @Get()
  getHome(
    @CurrentUser() user: { sub: string } | undefined,
  ): Promise<{ data: HomePayload }> {
    return this.homeService.getHome(user?.sub);
  }
}
