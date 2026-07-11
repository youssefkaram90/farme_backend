import {

  
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import * as argon2 from 'argon2';
import { UserUpdateInput, UserWhereInput } from '../generated/prisma/models';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}

  async create(data: CreateUserDto) {
    try {
      const hash = await argon2.hash(data.password);
      const user = await this.prismaService.user.create({
        data: { ...data, password: hash },
      });

      const { password, ...result } = user;
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new HttpException('Name already exists', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async getUser(where: Prisma.UserWhereInput) {
    try {
      const user = await this.prismaService.user.findFirst({
        where,
      });

      if (!user) throw new NotFoundException('user not found');

      return user;
    } catch (error) {
      throw error;
    }
  }

  async getUsers(){

    return this.prismaService.user.findMany({
      omit:{
        password:true,
        refreshToken:true,
      }
    });
  }

  async updateUser(where:UserWhereInput,data:UserUpdateInput){

    return this.prismaService.user.updateMany({
      where,
      data,
    })

  }
}
