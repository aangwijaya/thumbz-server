import { IsInt, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsInt()
  @Min(1)
  @Max(4)
  quantity: number;
}
