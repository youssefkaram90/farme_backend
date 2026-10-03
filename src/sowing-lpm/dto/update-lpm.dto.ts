import { IsOptional, IsUUID } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ExecuteLPMDto } from './execute-lpm.dto';

/**
 * The edit form's body: every field of `ExecuteLPMDto`, all optional (SSM-03 —
 * the same defect in the LPM twin, which shared its create dto with PATCH).
 *
 * `sectorId` is re-declared to accept an explicit `null`, so a sowing can be
 * taken out of a sector; leaving the field out keeps the sector it has. Without
 * the `null` there is no way to express "no sector", because the service reads
 * an absent id as "keep".
 *
 * It is **omitted** from the mapped type before being re-declared: a subclass
 * cannot widen a property it inherits (`Partial<ExecuteLPMDto>` says
 * `string | undefined`), so `OmitType` removes it from the parent first.
 */
export class UpdateLPMDto extends PartialType(
  OmitType(ExecuteLPMDto, ['sectorId'] as const),
) {
  @IsOptional()
  @IsUUID()
  sectorId?: string | null;
}
