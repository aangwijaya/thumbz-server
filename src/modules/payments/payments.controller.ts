import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AdminIdParamsDto } from '../admin/dto/admin-id-params.dto';
import { PaymentsService } from './payments.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

/** Provider callbacks: authenticity is checked per provider (HMAC / token). */
@ApiTags('webhooks')
@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('nowpayments')
  @HttpCode(HttpStatus.OK)
  async nowpayments(
    @Req() request: RawBodyRequest,
    @Headers('x-nowpayments-sig') signature?: string,
  ): Promise<{ ok: true }> {
    await this.payments.receive('nowpayments', request.rawBody, {
      'x-nowpayments-sig': signature,
    });
    return { ok: true };
  }

  @Public()
  @Post('xendit')
  @HttpCode(HttpStatus.OK)
  async xendit(
    @Req() request: RawBodyRequest,
    @Headers('x-callback-token') token?: string,
  ): Promise<{ ok: true }> {
    await this.payments.receive('xendit', request.rawBody, {
      'x-callback-token': token,
    });
    return { ok: true };
  }
}

/** Test mode only (PAYMENTS_SANDBOX=true): lets a buyer complete a demo payment. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/payments')
export class PaymentSimulationController {
  constructor(private readonly payments: PaymentsService) {}

  @ApiExcludeEndpoint()
  @Post(':id/simulate')
  @HttpCode(HttpStatus.ACCEPTED)
  async simulate(
    @Param() params: AdminIdParamsDto,
    @CurrentUser() user: CurrentUser,
  ): Promise<{ ok: true }> {
    await this.payments.simulate(params.id, user.sub);
    return { ok: true };
  }
}
