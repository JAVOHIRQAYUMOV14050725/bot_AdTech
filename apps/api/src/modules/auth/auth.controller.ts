import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Actor } from './decorators/actor.decorator';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { AuthResponseDto, MeResponseDto } from './dto/auth-response.dto';

// DTO qo'sh (oddiy)
class RefreshDto { refreshToken!: string; }
class ResetPasswordDto { telegramId!: string; newPassword!: string; }

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @UseGuards(AuthRateLimitGuard)
    @ApiOperation({ summary: 'Register new user' })
    @ApiCreatedResponse({ type: AuthResponseDto })
    @ApiStandardErrorResponses()
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('login')
    @UseGuards(AuthRateLimitGuard)
    @ApiOperation({ summary: 'Login' })
    @ApiOkResponse({ type: AuthResponseDto })
    @ApiStandardErrorResponses()
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @Post('refresh')
    @UseGuards(AuthRateLimitGuard)
    @ApiOperation({ summary: 'Refresh tokens' })
    refresh(@Body() dto: RefreshDto) {
        return this.authService.refresh(dto.refreshToken);
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Logout (revoke refresh token)' })
    logout(@Actor() actor: { id: string }) {
        return this.authService.logout(actor.id);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get current user' })
    @ApiOkResponse({ type: MeResponseDto })
    @ApiStandardErrorResponses()
    me(@Actor() actor: { id: string }) {
        return this.authService.me(actor.id);
    }

    // ⚠️ DEV/ADMIN: password esdan chiqqanda tez yechim
    // Prod'da bunu Telegram OTP flow bilan almashtirasan.
    @Post('reset-password')
    @ApiOperation({ summary: 'DEV: Reset password by telegramId' })
    resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPasswordByTelegramId(dto.telegramId, dto.newPassword);
    }
}
