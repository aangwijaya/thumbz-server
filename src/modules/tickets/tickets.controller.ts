import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { AdminIdParamsDto } from '../admin/dto/admin-id-params.dto';
import { MatchIdParamsDto } from '../matches/dto/match-id-params.dto';
import { AdminOrdersDto } from './dto/admin-orders.dto';
import {
  CheckInDto,
  CreateOrderDto,
  StartPaymentDto,
} from './dto/create-order.dto';
import { ListMyOrdersDto } from './dto/list-my-orders.dto';
import { ListMyTicketsDto } from './dto/list-my-tickets.dto';
import { TicketConfigDto } from './dto/ticket-config.dto';
import {
  CheckInResult,
  MatchTicketView,
  TicketAvailability,
  TicketOrderView,
  TicketsService,
} from './tickets.service';
import { Cached } from '../../infra/cache/cached.decorator';
import { CacheTags } from '../../infra/cache/cache-tags';

@ApiTags('matches')
@Controller('matches')
export class MatchTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Public()
  @Cached({ ttl: 5, tags: ({ id }) => [CacheTags.tickets(id)] })
  @Get(':id/ticket')
  availability(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: TicketAvailability | null }> {
    return this.tickets.availability(params.id);
  }

  @ApiBearerAuth()
  @Idempotent()
  @Post(':id/orders')
  createOrder(
    @Param() params: MatchIdParamsDto,
    @CurrentUser() user: CurrentUser,
    @Body() body: CreateOrderDto,
  ): Promise<{ data: TicketOrderView }> {
    return this.tickets.createOrder(
      params.id,
      user,
      body.quantity,
      body.payment_method ?? 'crypto',
    );
  }
}

@ApiTags('me')
@ApiBearerAuth()
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

  /** Pay a pending order with another method (supersedes earlier attempts). */
  @Idempotent()
  @Post('orders/:id/payments')
  startPayment(
    @Param() params: AdminIdParamsDto,
    @CurrentUser() user: CurrentUser,
    @Body() body: StartPaymentDto,
  ): Promise<{ data: TicketOrderView }> {
    return this.tickets.startPayment(user, params.id, body.method);
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

@ApiTags('admin')
@ApiBearerAuth()
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

  /** Venue scanners: verify a ticket QR and admit it once. */
  @Roles('admin')
  @Post('tickets/check-in')
  @HttpCode(HttpStatus.OK)
  checkIn(
    @Body() body: CheckInDto,
  ): Promise<{ data: { result: CheckInResult; code?: string } }> {
    return this.tickets.checkIn(body.payload);
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
