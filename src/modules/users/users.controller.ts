import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUser as CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { UserProfile, UsersService } from './users.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getMe(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: UserProfile }> {
    const profile = await this.usersService.getProfile(user.sub);
    if (profile === null) {
      throw new NotFoundException();
    }
    return { data: profile };
  }
}
