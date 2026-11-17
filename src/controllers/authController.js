const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { render } = require('@react-email/render');
const { resend, fromAddresses, emailTemplates } = require('./emailController');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || process.env.BETTER_AUTH_SECRET || 'herbalhub-jwt-secret-key';
const TOKEN_EXPIRY = '7d';

// Generate 6-digit numeric OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate JWT Token
function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role || 'user',
            name: user.name || ''
        },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );
}

// ============================================================
// SIGN UP CONTROLLER (Customer)
// ============================================================
exports.signUp = async (req, res) => {
    try {
        const { email, password, phone, fullName } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // 1. Check if user already exists
        let user = await prisma.user.findUnique({
            where: { email: normalizedEmail }
        });

        if (user && user.emailVerified) {
            return res.status(400).json({
                success: false,
                error: 'Email already registered. Please login.'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // 2. If unverified user exists, update; else create new
        if (user) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    name: fullName || user.name,
                    phone: phone || user.phone
                }
            });

            await prisma.account.deleteMany({
                where: { userId: user.id, providerId: 'credential' }
            });

            await prisma.account.create({
                data: {
                    userId: user.id,
                    accountId: user.id,
                    providerId: 'credential',
                    password: hashedPassword
                }
            });
        } else {
            user = await prisma.user.create({
                data: {
                    email: normalizedEmail,
                    name: fullName || 'Customer',
                    phone: phone || '',
                    role: 'user',
                    emailVerified: false,
                    accounts: {
                        create: {
                            accountId: normalizedEmail,
                            providerId: 'credential',
                            password: hashedPassword
                        }
                    }
                }
            });
        }

        // 3. Generate & store 6-digit OTP in Verification table (valid 15 mins)
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await prisma.verification.deleteMany({
            where: { identifier: `signup_${normalizedEmail}` }
        });

        await prisma.verification.create({
            data: {
                identifier: `signup_${normalizedEmail}`,
                value: otp,
                expiresAt
            }
        });

        // 4. Send Verification Email via Resend
        try {
            const emailHtml = await render(
                emailTemplates.verification({
                    otp: otp,
                    isPasswordReset: false
                })
            );

            await resend.emails.send({
                from: fromAddresses.verification,
                to: normalizedEmail,
                subject: 'Verify your email - Herbalhub',
                html: emailHtml
            });
        } catch (emailError) {
            console.error('❌ Verification email failed:', emailError.message);
        }

        return res.status(201).json({
            success: true,
            message: 'Account created. Check email for verification code.',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    phone: user.phone
                }
            }
        });

    } catch (error) {
        console.error('SignUp error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};

// ============================================================
// RESEND OTP CONTROLLER
// ============================================================
exports.resendOtp = async (req, res) => {
    try {
        const { email, isPasswordReset } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const identifier = isPasswordReset ? `reset_${normalizedEmail}` : `signup_${normalizedEmail}`;

        await prisma.verification.deleteMany({
            where: { identifier }
        });

        await prisma.verification.create({
            data: {
                identifier,
                value: otp,
                expiresAt
            }
        });

        try {
            const emailHtml = await render(
                emailTemplates.verification({
                    otp: otp,
                    isPasswordReset: !!isPasswordReset
                })
            );

            await resend.emails.send({
                from: fromAddresses.verification,
                to: normalizedEmail,
                subject: isPasswordReset ? 'Reset your password - Herbalhub' : 'Verify your email - Herbalhub',
                html: emailHtml
            });
        } catch (emailError) {
            console.error('Resend email error:', emailError);
        }

        return res.json({
            success: true,
            message: 'New verification code sent'
        });

    } catch (error) {
        console.error('Resend OTP error:', error);
        return res.status(500).json({ error: error.message || 'Failed to resend code' });
    }
};

// ============================================================
// VERIFY OTP CONTROLLER
// ============================================================
exports.verifyOtp = async (req, res) => {
    try {
        const { email, otp, isPasswordReset } = req.body;

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                error: 'Email and OTP are required'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const identifier = isPasswordReset ? `reset_${normalizedEmail}` : `signup_${normalizedEmail}`;

        const record = await prisma.verification.findFirst({
            where: {
                identifier,
                value: otp.toString().trim(),
                expiresAt: { gt: new Date() }
            }
        });

        if (!record) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired OTP code'
            });
        }

        // Delete used OTP
        await prisma.verification.delete({ where: { id: record.id } });

        // Update User emailVerified status
        const user = await prisma.user.update({
            where: { email: normalizedEmail },
            data: { emailVerified: true }
        });

        // Also ensure or sync Customer record in schema
        try {
            let customer = await prisma.customer.findFirst({
                where: { OR: [{ email: normalizedEmail }, { phone: user.phone || 'N/A' }] }
            });

            if (!customer) {
                const count = await prisma.customer.count();
                const customerCode = `CUS-${1000 + count + 1}`;
                await prisma.customer.create({
                    data: {
                        customerCode,
                        fullName: user.name || 'Customer',
                        email: normalizedEmail,
                        phone: user.phone || '',
                        status: true
                    }
                });
            }
        } catch (e) {
            console.warn('Customer sync warning:', e.message);
        }

        const token = generateToken(user);

        return res.status(200).json({
            success: true,
            message: 'Verification successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    phone: user.phone,
                    role: user.role
                },
                session: {
                    access_token: token,
                    refresh_token: token,
                    user: {
                        id: user.id,
                        email: user.email,
                        user_metadata: {
                            full_name: user.name,
                            phone: user.phone
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Verify OTP error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};

// ============================================================
// LOGIN CONTROLLER (Email or Phone)
// ============================================================
exports.login = async (req, res) => {
    try {
        const { email, phone, password } = req.body;

        if ((!email && !phone) || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email/Phone and password are required'
            });
        }

        let user;
        if (email) {
            user = await prisma.user.findUnique({
                where: { email: email.toLowerCase().trim() },
                include: { accounts: true }
            });
        } else if (phone) {
            user = await prisma.user.findFirst({
                where: { phone: phone.trim() },
                include: { accounts: true }
            });
        }

        if (!user) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        const credAccount = user.accounts?.find(a => a.providerId === 'credential');
        if (!credAccount || !credAccount.password) {
            return res.status(400).json({
                success: false,
                error: 'Invalid login credentials'
            });
        }

        const isMatch = await bcrypt.compare(password, credAccount.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        if (!user.emailVerified) {
            return res.status(400).json({
                success: false,
                error: 'Email not verified. Please verify your email first.'
            });
        }

        const token = generateToken(user);

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    phone: user.phone,
                    role: user.role
                },
                session: {
                    access_token: token,
                    refresh_token: token,
                    user: {
                        id: user.id,
                        email: user.email,
                        user_metadata: {
                            full_name: user.name,
                            phone: user.phone
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};

// ============================================================
// REQUEST PASSWORD RESET
// ============================================================
exports.requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'No account found with this email'
            });
        }

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await prisma.verification.deleteMany({
            where: { identifier: `reset_${normalizedEmail}` }
        });

        await prisma.verification.create({
            data: {
                identifier: `reset_${normalizedEmail}`,
                value: otp,
                expiresAt
            }
        });

        try {
            const emailHtml = await render(
                emailTemplates.verification({
                    otp: otp,
                    isPasswordReset: true
                })
            );

            await resend.emails.send({
                from: fromAddresses.verification,
                to: normalizedEmail,
                subject: 'Reset your password - Herbalhub',
                html: emailHtml
            });
        } catch (emailError) {
            console.error('Password reset email error:', emailError);
        }

        return res.status(200).json({
            success: true,
            message: 'Password reset code sent to your email'
        });

    } catch (error) {
        console.error('Request password reset error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};

// ============================================================
// UPDATE PASSWORD
// ============================================================
exports.updatePassword = async (req, res) => {
    try {
        const { newPassword } = req.body;
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid or expired token' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        const account = await prisma.account.findFirst({
            where: { userId: decoded.id, providerId: 'credential' }
        });

        if (account) {
            await prisma.account.update({
                where: { id: account.id },
                data: { password: hashedPassword }
            });
        } else {
            await prisma.account.create({
                data: {
                    userId: decoded.id,
                    accountId: decoded.id,
                    providerId: 'credential',
                    password: hashedPassword
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Password updated successfully'
        });

    } catch (error) {
        console.error('Update password error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};

// ============================================================
// GET CURRENT USER
// ============================================================
exports.getCurrentUser = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid or expired token' });
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.id }
        });

        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }

        return res.status(200).json({
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    phone: user.phone,
                    role: user.role,
                    user_metadata: {
                        full_name: user.name,
                        phone: user.phone
                    }
                }
            }
        });

    } catch (error) {
        console.error('Get current user error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};

// ============================================================
// REFRESH TOKEN
// ============================================================
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ success: false, error: 'Refresh token is required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(refreshToken, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid refresh token' });
        }

        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }

        const newToken = generateToken(user);

        return res.status(200).json({
            success: true,
            data: {
                session: {
                    access_token: newToken,
                    refresh_token: newToken
                }
            }
        });

    } catch (error) {
        console.error('Refresh token error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
};

// ============================================================
// LOGOUT
// ============================================================
exports.logout = async (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'Logged out successfully'
    });
};
