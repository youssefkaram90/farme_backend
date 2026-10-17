import { IsOptional, IsUUID } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ExecuteLPMDto } from './execute-lpm.dto';

/**
 * The edit form's body: every field of `ExecuteLPMDto`, all optional (SSM-03 —
 * the same defect in the LPM twin, which shared its create dto with PATCH).
 *
 * `sectorId` is re-declared to accept an explicit `null`, so a request can SAY
 * "no sector" — the service refuses it with a plain sentence (PSTOCK-20 (i): a
 * field sowing always belongs to one). Leaving the field out keeps the sector it
 * has. Accepting the `null` here is what makes that refusal possible at all:
 * without it the request would be rejected by the validation pipe instead, with
 * a message that explains nothing.
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
