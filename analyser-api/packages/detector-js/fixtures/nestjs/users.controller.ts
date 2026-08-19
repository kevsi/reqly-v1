import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth";

@Controller("users")
export class UsersController {
  @Get()
  findAll(@Query("page") page: string) {
    return [];
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return {};
  }

  @Post()
  @UseGuards(AuthGuard)
  create(@Body() createUserDto: CreateUserDto) {
    return createUserDto;
  }
}
