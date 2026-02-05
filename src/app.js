const express = require('express');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config/env');
const logger = require('./utils/logger');

// Initialize Express App
const app = express();
app.set('trust proxy', true);

// CORS Configuration
const cors = require('cors');

// Configure allowed origins based on environment
const allowedOrigins = [];

// Always allow localhost for development
allowedOrigins.push('http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:4173', 'http://localhost:4174');

// Add production origins from environment variables
if (config.crmUrl) allowedOrigins.push(config.crmUrl);
if (config.studentPortalUrl) allowedOrigins.push(config.studentPortalUrl);
if (config.mainWebsiteUrl) allowedOrigins.push(config.mainWebsiteUrl);

// Also add the origin from FRONTEND_URL if set
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

// Add wildcard for Vercel previews (in addition to specific domains from env vars)
allowedOrigins.push('https://*.vercel.app');

// Explicitly add the specific frontend domain to ensure it's allowed
allowedOrigins.push('https://jv-overseas-pvt-ltd-goz3.vercel.app');

// Add any explicitly allowed origins from environment
if (config.allowedOrigins && Array.isArray(config.allowedOrigins)) {
    allowedOrigins.push(...config.allowedOrigins);
}

// TEMPORARY: Allow all origins for debugging (remove in production)
// allowedOrigins.push('*');

// CORS Options
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // Explicitly allow all Vercel preview/production domains
        if (origin.endsWith('.vercel.app')) {
            logger.info(`[CORS] Origin: ${origin} - ALLOWED (Vercel domain)`);
            return callback(null, true);
        }

        // Check if origin is in allowed list
        const isAllowed = allowedOrigins.some(allowed => {
            // Handle wildcard domains
            if (allowed.includes('*')) {
                // Escape special regex characters except *
                const pattern = allowed
                    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/\*/g, '.*');
                const regex = new RegExp('^' + pattern + '$');
                return regex.test(origin);
            }
            return origin === allowed;
        });

        // Log for debugging
        logger.info(`[CORS] Origin: ${origin} - ${isAllowed ? 'ALLOWED' : 'BLOCKED'}`);
        if (!isAllowed) {
            logger.warn(`[CORS] Blocked origin: ${origin}. Allowed: ${allowedOrigins.join(', ')}`);
        }

        callback(null, isAllowed);
    },
    credentials: true,
    optionsSuccessStatus: 200, // For legacy browser support
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-auth-token', 'Accept', 'Origin', 'Cookie', 'Pragma', 'Cache-Control']
};

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));
app.options('/api/admin/gate', cors(corsOptions));

app.use(cors(corsOptions));

const cookieParser = require('cookie-parser');
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

app.use(helmet({
    contentSecurityPolicy: false, // Fully disable to ensure zero blocking
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer-when-downgrade" } // More permissive for redirects
}));

if (config.nodeEnv === 'development') {
    app.use(morgan('dev'));
}

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000, // Increased for production
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg: 'Too many requests, please try again later' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, // Increased to account for shared office IPs
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg: 'Too many login attempts, please try again after 15 minutes' }
});

// Public form submission limiter (prevent spam/abuse)
const publicFormLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100, // Increased
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg: 'Too many submissions, please try again later' }
});

// Student auth limiter
const studentAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200, // Increased
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg: 'Too many login attempts, please try again after 15 minutes' }
});

// OTP Request Rate Limiter (Prevent OTP spam/abuse)
const otpRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Max 5 OTP requests per 15 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg: 'Too many OTP requests. Please wait 15 minutes before requesting again.' },
    skipSuccessfulRequests: false // Count all requests, not just failures
});

// OTP Verification Rate Limiter (Prevent brute force)
const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 verification attempts per 15 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { msg: 'Too many verification attempts. Please wait 15 minutes.' }
});

app.use('/api/', generalLimiter);
app.use('/api/admin/login', authLimiter);
app.use('/api/admin/verify-otp', otpVerifyLimiter);
app.use('/api/admin/refresh-token', authLimiter);
app.use('/api/admin/profile/password/request-otp', otpRequestLimiter);
app.use('/api/admin/employees/request-otp', otpRequestLimiter);
app.use('/api/student/login', studentAuthLimiter);
app.use('/api/public/intake', publicFormLimiter); // Prevent form spam
app.use('/api/public/enquiry', publicFormLimiter);

// Import Routes
const publicRoutes = require('./routes/public.routes');
const adminRoutes = require('./routes/admin.routes');
const crmRoutes = require('./routes/crm.routes');
const lmsRoutes = require('./routes/lms.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const notesRoutes = require('./routes/notes.routes');
const chatRoutes = require('./routes/chat.routes');
const admissionRoutes = require('./routes/admission.routes');
const fieldAgentRoutes = require('./routes/field-agent.routes');
const studentRoutes = require('./routes/student.routes');
const tasksRoutes = require('./routes/tasks.routes');
const announcementsRoutes = require('./routes/announcements.routes');
const studyMaterialsRoutes = require('./routes/studyMaterials.routes');
const successRoutes = require('./routes/success.routes');
const trashRoutes = require('./routes/trash.routes');
const documentRoutes = require('./routes/document.routes');

const auth = require('./middleware/auth');
const notificationsRoutes = require('./routes/notifications.routes');

// Mount Routes
app.use('/api/public', publicRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/crm', auth, crmRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/lms', auth, lmsRoutes);
app.use('/api/attendance', auth, attendanceRoutes);
app.use('/api/employees', auth, notesRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admission', auth, admissionRoutes);
app.use('/api/field-agent', auth, fieldAgentRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/study-materials', studyMaterialsRoutes);
app.use('/api/success', successRoutes);
app.use('/api/trash', auth, trashRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/queries', require('./routes/queries.routes'));
app.use('/api/emp-queries', require('./routes/empQueries.routes'));

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        env: config.nodeEnv
    });
});

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Global Error Handler - Use logger, never expose internal errors in production
app.use((err, req, res, next) => {
    const logger = require('./utils/logger');

    // Log full error details server-side
    logger.error('SERVER_ERROR:', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
    });

    // Don't expose internal error details in production
    const isDevelopment = config.nodeEnv === 'development';

    res.status(err.status || 500).json({
        success: false,
        msg: 'Internal Server Error',
        error: isDevelopment ? err.message : 'An error occurred. Please try again later.',
        ...(isDevelopment && { stack: err.stack })
    });
});

app.get('/', (req, res) => {
    res.status(200).send('<h1>JV Overseas API Status: Running</h1>');
});

// Test CORS route
app.get('/test-cors', (req, res) => {
    res.status(200).json({ message: 'CORS test successful', origin: req.get('origin') });
});

module.exports = app;
