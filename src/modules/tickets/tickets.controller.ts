import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { AdminIdParamsDto } from '../admin/dto/admin-id-params.dto';
import { MatchIdParamsDto } from '../matches/dto/match-id-params.dto';
import { AdminOrdersDto } from './dto/admin-orders.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListMyOrdersDto } from './dto/list-my-orders.dto';
import { ListMyTicketsDto } from './dto/list-my-tickets.dto';
import { TicketConfigDto } from './dto/ticket-config.dto';
import {
  MatchTicketView,
  TicketAvailability,
  TicketOrderView,
  TicketsService,
} from './tickets.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('matches')
export class MatchTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Public()
  @Get(':id/ticket')
  availability(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: TicketAvailability | null }> {
    return this.tickets.availability(params.id);
  }

  @Post(':id/orders')
  createOrder(
    @Param() params: MatchIdParamsDto,
    @CurrentUser() user: { sub: string },
    @Body() body: CreateOrderDto,
  ): Promise<{ data: TicketOrderView }> {
    return this.tickets.createOrder(params.id, user, body.quantity);
  }
}

@Controller('me')
export class MeTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('orders')
  listOrders(
    @CurrentUser() user: { sub: string },
    @Query() query: ListMyOrdersDto,
  ): Promise<{ data: TicketOrderView[]; meta: PaginationMeta }> {
    return this.tickets.listOrders(user, query);
  }

  @Get('orders/:id')
  getOrder(
    @Param() params: AdminIdParamsDto,
    @CurrentUser() user: { sub: string },
  ): Promise<{ data: TicketOrderView; tickets: MatchTicketView[] }> {
    return this.tickets.getOrder(user, params.id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelOrder(
    @Param() params: AdminIdParamsDto,
    @CurrentUser() user: { sub: string },
  ): Promise<void> {
    await this.tickets.cancelOrder(user, params.id);
  }

  @Get('tickets')
  listTickets(
    @CurrentUser() user: { sub: string },
    @Query() query: ListMyTicketsDto,
  ): Promise<{ data: MatchTicketView[]; meta: PaginationMeta }> {
    return this.tickets.listTickets(user, query);
  }
}

@Controller('admin')
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Roles('admin')
  @Put('matches/:id/ticket-config')
  upsertConfig(
    @Param() params: AdminIdParamsDto,
    @Body() body: TicketConfigDto,
  ): Promise<{ data: TicketAvailability }> {
    return this.tickets.upsertConfig(params.id, body);
  }

  @Roles('admin')
  @Get('orders')
  listOrders(@Query() query: AdminOrdersDto): Promise<{
    data: Array<TicketOrderView & { user_id: string }>;
    meta: PaginationMeta;
  }> {
    return this.tickets.adminListOrders(query);
  }
}

@Controller('webhooks')
export class PaymentWebhooksController {
  constructor(private readonly tickets: TicketsService) {}

  @Public()
  @Post('nowpayments')
  @HttpCode(HttpStatus.OK)
  handleNowPayments(
    @Req() request: RawBodyRequest,
    @Headers('x-nowpayments-sig') signature?: string,
  ): Promise<{ ok: true }> {
    return this.tickets.handleWebhook(request.rawBody, signature);
  }
}
