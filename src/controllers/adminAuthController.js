const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { render } = require('@react-email/render');
const { resend, fromAddresses, emailTemplates } = require('./emailController');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || process.env.BETTER_AUTH_SECRET || 'herbalhub-jwt-secret-key';
const TOKEN_EXPIRY = '7d';

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role || 'admin',
            name: user.name || ''
        },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );
}

// Sign Up Controller (Admin)
exports.signUp = async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (user && user.emailVerified) {
            return res.status(400).json({ success: false, error: 'Email already registered. Please login.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        if (user) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: { name: name || user.name }
            });
            await prisma.account.deleteMany({ where: { userId: user.id, providerId: 'credential' } });
            await prisma.account.create({
                data: { userId: user.id, accountId: user.id, providerId: 'credential', password: hashedPassword }
            });
        } else {
            user = await prisma.user.create({
                data: {
                    email: normalizedEmail,
                    name: name || 'Admin',
                    role: 'admin',
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

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await prisma.verification.deleteMany({ where: { identifier: `admin_signup_${normalizedEmail}` } });
        await prisma.verification.create({
            data: { identifier: `admin_signup_${normalizedEmail}`, value: otp, expiresAt }
        });

        try {
            const emailHtml = await render(
                emailTemplates.verification({ otp, isPasswordReset: false })
            );
            await resend.emails.send({
                from: fromAddresses.verification,
                to: normalizedEmail,
                subject: 'Verify your admin account - Herbalhub',
                html: emailHtml
            });
        } catch (e) {
            console.error('Email error:', e);
        }

        return res.status(201).json({
            success: true,
            message: 'Account created. Check email for verification code.',
            data: { user: { id: user.id, email: user.email } }
        });

    } catch (error) {
        console.error('Admin SignUp error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Resend OTP
exports.resendOtp = async (req, res) => {
    try {
        const { email, isPasswordReset } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const identifier = isPasswordReset ? `admin_reset_${normalizedEmail}` : `admin_signup_${normalizedEmail}`;

        await prisma.verification.deleteMany({ where: { identifier } });
        await prisma.verification.create({
            data: { identifier, value: otp, expiresAt }
        });

        try {
            const emailHtml = await render(
                emailTemplates.verification({ otp, isPasswordReset: !!isPasswordReset })
            );
            await resend.emails.send({
                from: fromAddresses.verification,
                to: normalizedEmail,
                subject: isPasswordReset ? 'Reset your admin password - Herbalhub' : 'Verify your admin account - Herbalhub',
                html: emailHtml
            });
        } catch (e) {
            console.error('Email error:', e);
        }

        return res.json({ success: true, message: 'New verification code sent' });

    } catch (error) {
        console.error('Admin Resend OTP error:', error);
        return res.status(500).json({ error: 'Failed to resend code' });
    }
};

// Verify OTP
exports.verifyOtp = async (req, res) => {
    try {
        const { email, otp, isPasswordReset } = req.body;
        if (!email || !otp) return res.status(400).json({ success: false, error: 'Email and OTP required' });

        const normalizedEmail = email.toLowerCase().trim();
        const identifier = isPasswordReset ? `admin_reset_${normalizedEmail}` : `admin_signup_${normalizedEmail}`;

        const record = await prisma.verification.findFirst({
            where: { identifier, value: otp.toString().trim(), expiresAt: { gt: new Date() } }
        });

        if (!record) {
            return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
        }

        await prisma.verification.delete({ where: { id: record.id } });

        const user = await prisma.user.update({
            where: { email: normalizedEmail },
            data: { emailVerified: true, role: 'admin' }
        });

        const token = generateToken(user);

        return res.status(200).json({
            success: true,
            data: {
                user: { id: user.id, email: user.email, name: user.name, role: 'admin' },
                session: {
                    access_token: token,
                    refresh_token: token,
                    user: {
                        id: user.id,
                        email: user.email,
                        user_metadata: { full_name: user.name }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Admin Verify OTP error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Login
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            include: { accounts: true }
        });

        if (!user) {
            return res.status(400).json({ success: false, error: 'Invalid email or password' });
        }

        const credAccount = user.accounts?.find(a => a.providerId === 'credential');
        if (!credAccount || !credAccount.password) {
            return res.status(400).json({ success: false, error: 'Invalid login credentials' });
        }

        const isMatch = await bcrypt.compare(password, credAccount.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, error: 'Invalid email or password' });
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
                    role: user.role
                },
                session: {
                    access_token: token,
                    refresh_token: token,
                    user: {
                        id: user.id,
                        email: user.email,
                        user_metadata: {
                            full_name: user.name
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Request Password Reset
exports.requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const normalizedEmail = email.toLowerCase().trim();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await prisma.verification.deleteMany({ where: { identifier: `admin_reset_${normalizedEmail}` } });
        await prisma.verification.create({
            data: { identifier: `admin_reset_${normalizedEmail}`, value: otp, expiresAt }
        });

        try {
            const emailHtml = await render(
                emailTemplates.verification({ otp, isPasswordReset: true })
            );
            await resend.emails.send({
                from: fromAddresses.verification,
                to: normalizedEmail,
                subject: 'Reset your admin password - Herbalhub',
                html: emailHtml
            });
        } catch (e) {
            console.error('Email error:', e);
        }

        return res.status(200).json({ success: true, message: 'Password reset code sent' });

    } catch (error) {
        console.error('Admin Reset Request error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Update Password
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
            return res.status(401).json({ success: false, error: 'Invalid token' });
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

        return res.status(200).json({ success: true, message: 'Password updated successfully' });

    } catch (error) {
        console.error('Admin Update Password error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Get Current User
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
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }

        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user) return res.status(401).json({ success: false, error: 'User not found' });

        return res.status(200).json({
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    user_metadata: { full_name: user.name }
                }
            }
        });

    } catch (error) {
        console.error('Admin Get Current User error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Refresh Token
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ success: false, error: 'Refresh token required' });

        let decoded;
        try {
            decoded = jwt.verify(refreshToken, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ success: false, error: 'Invalid refresh token' });
        }

        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user) return res.status(401).json({ success: false, error: 'User not found' });

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
        console.error('Admin refresh token error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Logout
exports.logout = async (req, res) => {
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
};
