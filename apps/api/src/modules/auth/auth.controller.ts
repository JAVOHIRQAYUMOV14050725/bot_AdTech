
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Actor } from './decorators/actor.decorator';
import { Throttle } from '@nestjs/throttler';
import { ApiStandardErrorResponses } from '@/common/swagger/api-standard-error-responses.decorator';
import { AuthResponseDto, MeResponseDto } from './dto/auth-response.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { BootstrapSuperAdminDto } from './dto/bootstrap-super-admin.dto';
import { BootstrapResponseDto } from './dto/bootstrap-response.dto';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { UserRole } from '@/modules/domain/contracts';
import { InvitePublisherDto } from './dto/invite-publisher.dto';
import { TelegramStartDto } from './dto/telegram-start.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { TelegramInternalTokenGuard } from './guards/telegram-internal-token.guard';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.admin, UserRole.super_admin)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Admin/Ops: Invite publisher (pending Telegram link)',
        description:
            'Invite-only. Creates a pending publisher account. Users must start the Telegram bot with /start to complete registration.',
    })
    @ApiCreatedResponse({ type: RegisterResponseDto })
    @ApiStandardErrorResponses()
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Post('invite-publisher')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.admin, UserRole.super_admin)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Admin: Invite publisher (pending Telegram link)',
    })
    @ApiCreatedResponse({ type: RegisterResponseDto })
    @ApiStandardErrorResponses()
    invitePublisher(@Body() dto: InvitePublisherDto) {
        return this.authService.invitePublisher(dto);
    }

    @Post('bootstrap-super-admin')
    @ApiOperation({ summary: 'Bootstrap initial super admin (one-time)' })
    @ApiCreatedResponse({ type: BootstrapResponseDto })
    @ApiStandardErrorResponses()
    bootstrapSuperAdmin(@Body() dto: BootstrapSuperAdminDto) {
        return this.authService.bootstrapSuperAdmin(dto);
    }

    @Post('telegram/start')
    @UseGuards(TelegramInternalTokenGuard)
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    @ApiOperation({
        summary: 'Telegram: link or create user on /start',
        description:
            'This endpoint is called only by the Telegram bot. Do not call manually from Swagger. telegramId comes from Telegram update.',
    })
    @ApiStandardErrorResponses()
    telegramStart(@Body() dto: TelegramStartDto) {
        return this.authService.handleTelegramStart({
            telegramId: dto.telegramId,
            username: dto.username ?? null,
            startPayload: dto.startPayload ?? null,
            updateId: dto.updateId ?? null,
        });
    }

    @Post('login')
    @Throttle({ default: { limit: 3, ttl: 300_000 } })
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
    @ApiOperation({ summary: 'Admin: Reset password by external identifier' })
    resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPasswordByIdentifier(dto.identifier, dto.newPassword);
    }

    @Post('role/change')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.admin, UserRole.super_admin)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Admin: Change user role (audited)' })
    @ApiStandardErrorResponses()
    changeRole(@Actor() actor: { id: string }, @Body() dto: ChangeRoleDto) {
        return this.authService.changeUserRole({
            actorId: actor.id,
            userId: dto.userId,
            role: dto.role,
            reason: dto.reason,
        });
    }
}
