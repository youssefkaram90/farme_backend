import { UserRole } from '../../users/enums/userRole.enum';
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}
