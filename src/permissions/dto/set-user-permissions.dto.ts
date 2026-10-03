import { IsArray, IsUUID } from 'class-validator';

export class SetUserPermissionsDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  permissionIds!: string[];
}
