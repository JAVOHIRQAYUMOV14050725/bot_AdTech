import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Actor } from './decorators/actor.decorator';
import { AppThrottlerGuard } from '@/common/guards/app-throttler.guard';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { AuthResponseDto, MeResponseDto } from './dto/auth-response.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @ApiOperation({ summary: 'Register new user' })
    @ApiCreatedResponse({ type: RegisterResponseDto })
    @ApiStandardErrorResponses()
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('bootstrap-super-admin')
    @ApiOperation({ summary: 'Bootstrap initial super admin (one-time)' })
    @ApiCreatedResponse({ type: RegisterResponseDto })
    @ApiStandardErrorResponses()
    bootstrapSuperAdmin(@Body() dto: BootstrapSuperAdminDto) {
        return this.authService.bootstrapSuperAdmin(dto);
    }

    @Post('login')
    @UseGuards(AppThrottlerGuard)
    @Throttle({ default: { limit: 3, ttl: 300 } })
    @ApiOperation({ summary: 'Login' })
    @ApiOkResponse({ type: AuthResponseDto })
    @ApiStandardErrorResponses()
    login(@Body() dto: LoginDto) {
        return this.authService.login(dto);
    }

    @Post('refresh')
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
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.super_admin)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Admin: Reset password by telegramId' })
    resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPasswordByTelegramId(dto.telegramId, dto.newPassword);
    }
}
