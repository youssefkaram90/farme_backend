import { PartialType } from '@nestjs/mapped-types';
import { CreateTunnelDto } from './create-tunnel.dto';

/**
 * The edit form's body (TUN-03). The PATCH route took `CreateTunnelDto`, so a
 * request that changed only the number was refused — `capacity` was mandatory —
 * and because the global validation pipe answers every missing field with one
 * and the same sentence, nothing said which field was at fault.
 *
 * Every field optional: an omitted field means "keep what is there".
 */
export class UpdateTunnelDto extends PartialType(CreateTunnelDto) {}
