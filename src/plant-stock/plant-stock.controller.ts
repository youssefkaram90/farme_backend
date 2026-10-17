import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlantStockService } from './plant-stock.service';
import { UpdatePlantStockDto } from './dto/update-plant-stock.dto';
import { SavePlantCountDto } from './dto/save-plant-count.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { RequirePermissions } from '../permissions/decorators/require-permissions.decorator';

@Controller('plant-stock')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PlantStockController {
  constructor(private readonly plantStockService: PlantStockService) {}

  @Get()
  @RequirePermissions('plant-stock.view')
  findAll(
    @Query('q') q?: string,
    @Query('stage') stage?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.plantStockService.findAll(q, stage, page, pageSize);
  }

  /**
   * One batch, as a detail screen would show it — the row the list builds for a
   * batch taken as a whole.
   *
   * **Nothing calls it yet** (kept by decision 2026-10-01, PSTOCK-07). Both
   * clients build only `/plant-stock` and the list's own rows, and the web has no
   * proxy route for this one, so it is unused — but kept on purpose as
   * the batch-detail endpoint, not left behind by accident.
   */
  @Get(':id')
  @RequirePermissions('plant-stock.view')
  findOne(@Param('id') id: string) {
    return this.plantStockService.findOne(id);
  }

  /**
   * The readings for one batch — sent whole (PSTOCK-24, decided 2026-10-11).
   *
   * PUT, not POST: the body IS the count, so adding a reading, correcting a typo
   * and taking one back are all the same act — save the list. POSTing a reading at
   * a time made "a batch" mean as many counts as visits, each with its own
   * germination figure, and the operator had to work out which one the batch was
   * judged by. There is one figure per batch now, and it is the server's.
   *
   * `plant-stock.create` — recording a count, whenever it happens. The route
   * addresses the BATCH; the batch's tunnel travels in the body, because an SSM
   * batch spread over two tunnels is counted once per tunnel and each keeps its
   * own readings.
   */
  @Put(':id/counts')
  @RequirePermissions('plant-stock.create')
  saveCount(@Param('id') id: string, @Body() dto: SavePlantCountDto) {
    return this.plantStockService.saveCount(id, dto);
  }

  /**
   * Delete ONE count (PSTOCK-10, decided 2026-10-08).
   *
   * `plant-stock.create` — the same permission that records a count, so whoever
   * typed a number can take it back and nobody has to be handed a new tick-box
   * for it. (`plant-stock.edit` guards a route no screen uses at all —
   * PSTOCK-12 — and correcting your own sample is not what that permission is
   * for.)
   *
   * The path carries the COUNT's id, not the batch's, which is why it is not
   * `:id/counts`: opening the count is enough to find its batch, and its sowing,
   * and therefore its season. It is a hard delete — the screen asks first.
   */
  @Delete('counts/:countId')
  @RequirePermissions('plant-stock.create')
  removeCount(@Param('countId') countId: string) {
    return this.plantStockService.removeCount(countId);
  }

  @Patch(':id')
  @RequirePermissions('plant-stock.edit')
  update(@Param('id') id: string, @Body() dto: UpdatePlantStockDto) {
    return this.plantStockService.update(id, dto);
  }
}
