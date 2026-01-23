import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Actor } from './decorators/actor.decorator';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { AuthResponseDto, MeResponseDto } from './dto/auth-response.dto';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @UseGuards(AuthRateLimitGuard)
    @ApiOperation({
        summary: 'Register new user',
        description: 'Create a new advertiser or publisher account.',
    })
    @ApiCreatedResponse({ type: AuthResponseDto })
    @ApiStandardErrorResponses()
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    @UseGuards(AuthRateLimitGuard)
    @ApiOperation({
        summary: 'Login',
        description: 'Authenticate user with telegramId and password.',
    })
    @ApiOkResponse({ type: AuthResponseDto })
    @ApiStandardErrorResponses()
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Get current user',
        description: 'Retrieve the authenticated user profile.',
    })
    @ApiOkResponse({ type: MeResponseDto })
    @ApiStandardErrorResponses()
    me(@Actor() actor: { id: string }) {
        return this.authService.me(actor.id);
    }
}