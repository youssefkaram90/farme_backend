import { IsOptional, IsUUID } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ExecuteSSMDto } from './execute-ssm.dto';

/**
 * The edit form's body: every field of `ExecuteSSMDto`, all optional (SSM-03).
 *
 * The PATCH route used to take the CREATE dto, so an edit had to re-send the
 * plan, the variety, the date, the lot, the trays and the tunnel even when only
 * one of them changed — and a client that sent just the changed field was
 * refused by validation, with the one generic sentence the global pipe returns
 * for every missing field, so nothing said which field was missing.
 *
 * `tunnelId` is re-declared to accept an explicit `null`: leaving it out keeps
 * the tunnel the sowing already has, `null` clears it. Otherwise there would be
 * no way to un-assign a tunnel at all.
 *
 * It has to be **omitted** from the mapped type before it is re-declared: a
 * subclass may not widen a property it inherits (`Partial<ExecuteSSMDto>` says
 * `string | undefined`, and `string | null | undefined` is not assignable to
 * it), so `OmitType` takes it out of the parent's shape first.
 */
export class UpdateSSMDto extends PartialType(
  OmitType(ExecuteSSMDto, ['tunnelId'] as const),
) {
  @IsOptional()
  @IsUUID()
  tunnelId?: string | null;
}
