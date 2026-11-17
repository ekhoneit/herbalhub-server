// authMiddleware.js - Custom Better-Auth / JWT Middleware

const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || process.env.BETTER_AUTH_SECRET || "herbalhub-jwt-secret-key";

exports.authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }

        const token = authHeader.split(" ")[1];

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (jwtErr) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token",
            });
        }

        // Fetch fresh user from database ('herbalhub' schema)
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found",
            });
        }

        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            email_confirmed_at: user.emailVerified ? new Date() : null,
            user_metadata: {
                full_name: user.name,
                phone: user.phone,
                role: user.role,
            },
        };
        req.token = token;

        next();
    } catch (err) {
        console.error("AuthMiddleware error:", err);
        return res.status(500).json({
            success: false,
            message: "Authentication failed",
        });
    }
};

// Role-based middleware
exports.requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized",
            });
        }

        const userRole = req.user.role || req.user.user_metadata?.role || "user";

        if (!roles.includes(userRole)) {
            return res.status(403).json({
                success: false,
                error: "Insufficient permissions",
            });
        }

        next();
    };
};

// Email verification check
exports.requireEmailVerified = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized",
        });
    }

    if (!req.user.email_confirmed_at) {
        return res.status(403).json({
            success: false,
            error: "Email not verified",
        });
    }

    next();
};
