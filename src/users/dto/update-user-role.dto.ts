import { IsEnum } from 'class-validator';
import { UserRole } from '../enums/userRole.enum';

export class UpdateUserRoleDto {
  @IsEnum(UserRole)
  role!: UserRole;
}
