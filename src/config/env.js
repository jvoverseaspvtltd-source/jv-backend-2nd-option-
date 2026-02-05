const dotenv = require('dotenv');
// Load environment variables based on NODE_ENV
dotenv.config();

// PRODUCTION SECURITY: Fail fast if critical secrets are missing
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Validate critical environment variables
if (isProduction) {
  if (!process.env.JWT_SECRET) {
    throw new Error('CRITICAL: JWT_SECRET environment variable is required in production');
  }
  if (!process.env.SUPABASE_URL) {
    throw new Error('CRITICAL: SUPABASE_URL environment variable is required in production');
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_KEY) {
    throw new Error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY environment variable is required in production');
  }
  if (!process.env.FRONTEND_URL) {
    throw new Error('CRITICAL: FRONTEND_URL environment variable is required in production');
  }

  // Email validation based on provider (NON-BLOCKING - server can start without email)
  const emailProvider = process.env.EMAIL_PROVIDER || 'gmail';

  if (emailProvider === 'gmail') {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('⚠️ WARNING: EMAIL_USER and EMAIL_PASS are not set. Email functionality will be disabled.');
    }
  } else if (emailProvider === 'brevo') {
    if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
      console.warn('⚠️ WARNING: BREVO_SMTP_USER and BREVO_SMTP_PASS are not set. Email functionality will be disabled.');
    }
  }
}

// Helper to get JWT secret with fallback only in development
const getJWTSecret = (envVar, fallbackName) => {
  if (isProduction && !process.env[envVar]) {
    throw new Error(`CRITICAL: ${envVar} environment variable is required in production`);
  }
  return process.env[envVar] || process.env.JWT_SECRET || (isProduction ? null : `dev-${fallbackName}`);
};

// Get base JWT secret
const baseJWTSecret = getJWTSecret('JWT_SECRET', 'base-secret');

if (isProduction && !baseJWTSecret) {
  throw new Error('CRITICAL: JWT_SECRET environment variable is required in production');
}

module.exports = {
  nodeEnv,
  port: process.env.PORT || 5001,

  // Database
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,

  // JWT Secrets - Department-specific for enhanced security
  // PRODUCTION: All secrets must be set via environment variables
  jwtSecret: baseJWTSecret,
  jwtSecrets: {
    // New Department-Code based keys
    ADMIN: getJWTSecret('JWT_SECRET_ADMIN', 'admin-secret'),
    SUPER_ADMIN: getJWTSecret('JWT_SECRET_ADMIN', 'admin-secret'),
    COUN: getJWTSecret('JWT_SECRET_COUNSELLOR', 'counsellor-secret'),
    COUNSELLOR: getJWTSecret('JWT_SECRET_COUNSELLOR', 'counsellor-secret'),
    ADMN: getJWTSecret('JWT_SECRET_ADMISSION', 'admission-secret'),
    ADMISSION: getJWTSecret('JWT_SECRET_ADMISSION', 'admission-secret'),
    WFH: getJWTSecret('JWT_SECRET_WFH', 'wfh-secret'),
    FIELD: getJWTSecret('JWT_SECRET_FIELD', 'field-secret'),

    // Backwards compatibility for existing tokens
    super_admin: getJWTSecret('JWT_SECRET_ADMIN', 'admin-secret'),
    counsellor: getJWTSecret('JWT_SECRET_COUNSELLOR', 'counsellor-secret'),
    admission: getJWTSecret('JWT_SECRET_ADMISSION', 'admission-secret'),
    wfh: getJWTSecret('JWT_SECRET_WFH', 'wfh-secret'),
    field: getJWTSecret('JWT_SECRET_FIELD', 'field-secret'),
  },

  // Email
  emailProvider: process.env.EMAIL_PROVIDER || 'gmail',
  gmailUser: process.env.EMAIL_USER,
  gmailPass: process.env.EMAIL_PASS,
  emailFromName: process.env.EMAIL_FROM_NAME || 'JV Overseas',
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS || 'jvoverseaspvtltd@gmail.com',
  brevoApiKey: process.env.BREVO_API_KEY,
  brevoSmtpUser: process.env.BREVO_SMTP_USER ? process.env.BREVO_SMTP_USER.trim() : undefined,
  brevoSmtpPass: process.env.BREVO_SMTP_PASS ? process.env.BREVO_SMTP_PASS.trim() : undefined,
  brevoSmtpHost: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  brevoSmtpPort: process.env.BREVO_SMTP_PORT || 587,

  // Frontend URLs
  crmUrl: process.env.CRM_FRONTEND_URL || process.env.FRONTEND_URL,
  studentPortalUrl: process.env.STUDENT_PORTAL_URL,
  mainWebsiteUrl: process.env.MAIN_WEBSITE_URL || 'https://jvoverseas.com',

  // Dynamic CORS Origins (Comma-separated string)
  allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [],

  // Company Branding & Support
  companyName: process.env.COMPANY_NAME || 'JV Overseas',
  supportEmail: process.env.SUPPORT_EMAIL || 'support@jvoverseas.com',
  supportPhone: process.env.SUPPORT_PHONE || '+91 8712275590',
  companyAddress: process.env.COMPANY_ADDRESS || 'Medara Bazar, Chilakaluripet, AP',

  // Cloudinary
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,

  // Testing/Development Bypasses
  // PRODUCTION SECURITY: OTP bypass is NEVER allowed in production
  skipOtp: isProduction ? false : (process.env.SKIP_OTP === 'true')
};
