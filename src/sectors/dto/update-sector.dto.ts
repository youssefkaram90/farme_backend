import { PartialType } from '@nestjs/mapped-types';
import { CreateSectorDto } from './create-sector.dto';

/**
 * The edit form's body (the same defect TUN-03 found in the tunnels controller,
 * one field milder): PATCH took `CreateSectorDto`, so renaming a sector without
 * re-sending its name was refused, and the one sentence the validation pipe
 * returns for a missing field said nothing about which one it was.
 *
 * Every field optional: an omitted field means "keep what is there".
 */
export class UpdateSectorDto extends PartialType(CreateSectorDto) {}
