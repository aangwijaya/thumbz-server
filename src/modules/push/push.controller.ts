import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUser as CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  PushEndpointQueryDto,
  PushSubscriptionDto,
} from './dto/push-subscription.dto';
import { PushService } from './push.service';

@ApiTags('push')
@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  /** VAPID public key for PushManager.subscribe (contract §18). */
  @Public()
  @Get('push/config')
  config(): { data: { enabled: boolean; public_key: string | null } } {
    return { data: this.push.publicConfig() };
  }

  @ApiBearerAuth()
  @Put('me/push-subscriptions')
  async subscribe(
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: PushSubscriptionDto,
  ): Promise<{ data: { endpoint: string; created_at: Date } }> {
    return { data: await this.push.subscribe(user.sub, body) };
  }

  @ApiBearerAuth()
  @Delete('me/push-subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: PushEndpointQueryDto,
  ): Promise<void> {
    await this.push.unsubscribe(user.sub, query.endpoint);
  }

  @ApiBearerAuth()
  @Post('me/push-subscriptions/test')
  @HttpCode(HttpStatus.ACCEPTED)
  async test(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: { sent: number } }> {
    return { data: await this.push.sendTest(user.sub) };
  }
}
