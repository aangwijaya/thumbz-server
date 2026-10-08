import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { SearchDto } from './dto/search.dto';
import { SearchResults, SearchService } from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Get()
  search(
    @Query() query: SearchDto,
  ): Promise<{ data: SearchResults; meta: PaginationMeta }> {
    return this.searchService.search(query);
  }
}
