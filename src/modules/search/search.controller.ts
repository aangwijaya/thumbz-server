import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { CacheTags } from '../../infra/cache/cache-tags';
import { Cached } from '../../infra/cache/cached.decorator';
import { SearchDto, SuggestDto } from './dto/search.dto';
import {
  SearchCounts,
  SearchResults,
  SearchService,
  SearchSuggestion,
} from './search.service';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get()
  search(@Query() query: SearchDto): Promise<{
    data: SearchResults;
    meta: PaginationMeta & { counts: SearchCounts };
  }> {
    return this.searchService.search(query);
  }

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get('suggest')
  suggest(@Query() query: SuggestDto): Promise<{ data: SearchSuggestion[] }> {
    return this.searchService.suggest(query);
  }
}
