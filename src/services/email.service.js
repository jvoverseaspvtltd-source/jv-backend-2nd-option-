const nodemailer = require('nodemailer');
const config = require('../config/env');
const logger = require('../utils/logger');

// ============================================================================
// EMAIL  CONFIGURATION (MODULAR with AUTO-HEALING)
// ============================================================================

let transporter = null;

// Helper to create transport config object
const getBrevoConfig = (port) => {
    const isSecure = port === 465;
    return {
        host: config.brevoSmtpHost || 'smtp-relay.brevo.com',
        port: port,
        secure: isSecure, // True for 465, False for others
        pool: true,
        maxConnections: 3, // Lower concurrency for reliability
        maxMessages: 100,
        rateDelta: 1000,
        rateLimit: 5,
        auth: {
            user: config.brevoSmtpUser,
            pass: config.brevoSmtpPass
        },
        connectionTimeout: 10000, // Short timeout for probing
        greetingTimeout: 10000,
        socketTimeout: 20000,
        debug: false // Disable debug for probing to reduce noise
    };
};

const createGmailTransport = () => {
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        pool: true,
        maxConnections: 5,
        auth: {
            user: config.gmailUser,
            pass: config.gmailPass
        }
    });
};

/**
 * Intelligent Transporter Initialization
 * Automatically attempts to find an open port if using Brevo.
 */
const initTransporter = async () => {
    try {
        const provider = config.emailProvider;

        if (provider === 'brevo') {
            if (!config.brevoSmtpUser || !config.brevoSmtpPass) {
                logger.error('❌ CRITICAL: Brevo SMTP credentials missing.');
                return null;
            }

            // Ports to try in order of likelihood to work (2525 is confirmed working on Render)
            // If user specified a port in env, try that first. otherwise default list.
            const userPort = config.brevoSmtpPort ? parseInt(config.brevoSmtpPort) : null;
            // Prioritize 2525 because logs confirmed it connects (even if auth failed)
            const portsToTry = userPort ? [userPort, 2525, 587, 465] : [2525, 587, 465];

            // Deduplicate ports
            const uniquePorts = [...new Set(portsToTry)];

            logger.info(`📧 Email Provider: BREVO. Attempting connection on ports: ${uniquePorts.join(', ')}...`);

            for (const port of uniquePorts) {
                logger.info(`👉 Probing Brevo SMTP on Port ${port}...`);
                const transportConfig = getBrevoConfig(port);
                const tempTransporter = nodemailer.createTransport(transportConfig);

                try {
                    await tempTransporter.verify();
                    logger.info(`✅ SUCCESS: Connected to Brevo on Port ${port}`);

                    // Finalize transporter with slightly longer timeouts for production use
                    transportConfig.connectionTimeout = 20000;
                    transportConfig.greetingTimeout = 20000;
                    transportConfig.debug = config.nodeEnv === 'development';

                    transporter = nodemailer.createTransport(transportConfig);
                    return transporter;
                } catch (err) {
                    logger.warn(`⚠️ Failed to connect on Port ${port}: ${err.message}`);
                    tempTransporter.close();
                }
            }

            logger.warn('❌ ALL PORTS FAILED: Could not connect to Brevo SMTP. Attempting Fallback to Gmail...');
            // Fall through to Gmail configuration
        }

        // ============================================================
        // GMAIL FALLBACK / DEFAULT
        // ============================================================

        if (!config.gmailUser || !config.gmailPass) {
            if (provider === 'brevo') {
                logger.error('❌ CRITICAL: Brevo Failed and Gmail credentials missing. Cannot send emails.');
            } else {
                logger.error('❌ CRITICAL: Gmail SMTP credentials missing.');
            }
            return null;
        }

        logger.info('📧 Initializing Gmail SMTP Provider...');
        transporter = createGmailTransport();

        // Verify Gmail
        try {
            await transporter.verify();
            logger.info('✅ Gmail SMTP Ready');
            return transporter;
        } catch (error) {
            logger.error(`❌ Gmail Connection Failed: ${error.message}`);
            return null;
        }
    } catch (err) {
        logger.error(`❌ SMTP Initialization Critical Error: ${err.message}`);
        return null;
    }
};

// NOTE: initTransporter() is now called explicitly from server.js startup
// Do not call it here to avoid double initialization

// ============================================================================
// PUBLIC API
// ============================================================================

const _sendMailInternal = async (to, subject, htmlContent) => {
    if (!transporter) {
        // Try initializing again if it failed briefly before (lazy retry)
        await initTransporter();
        if (!transporter) throw new Error('Email transporter not initialized (Check logs)');
    }

    const mailOptions = {
        from: `"${config.emailFromName}" <${config.emailFromAddress}>`,
        to,
        subject,
        html: htmlContent.html || htmlContent,
    };

    if (htmlContent.attachments && Array.isArray(htmlContent.attachments)) {
        mailOptions.attachments = htmlContent.attachments;
    }

    return transporter.sendMail(mailOptions);
};

const sendMail = (to, subject, htmlContent) => {
    _sendMailInternal(to, subject, htmlContent)
        .then(info => {
            logger.info(`📧 Email sent to ${to} (ID: ${info.messageId})`);
        })
        .catch(err => {
            logger.error(`❌ Delivery Failed [${to}]: ${err.message}`);
        });
    return true;
};

// ============================================================================
// TEMPLATES (Unchanged)
// ============================================================================

const getBrandingHeader = (fontSize = '18px', color = '#0f172a') => {
    const INLINE_LOGO_SVG = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
      <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
    </svg>`;
    return `<span style="vertical-align: middle; font-family: 'Segoe UI', Arial, sans-serif; font-weight: 800; font-size: ${fontSize}; color: ${color}; letter-spacing: -0.5px;">${INLINE_LOGO_SVG} ${config.companyName.toUpperCase()}</span>`;
};

const sendEligibilityConfirmation = async (userEmail, userName, isEligible, estimatedRange) => {
    const branding = getBrandingHeader('20px');
    const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #f1f5f9; border-radius: 16px;"><div style="text-align: center; margin-bottom: 30px;">${branding}</div><h2>Hello ${userName},</h2><p>Your loan eligibility check is complete.</p><div style="background: #f0f7ff; padding: 15px; border-radius: 8px; margin: 20px 0;">${isEligible ? `<b style="color: #28a745;">✓ Eligible:</b> ${estimatedRange}` : `<b>We need more details to confirm your eligibility.</b>`}</div><p>Our loan advisors will contact you shortly to discuss the next steps.</p><p style="margin-top: 30px;">Best regards,<br><b>Team ${config.companyName}</b></p><hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;"><p style="font-size: 12px; color: #666; text-align: center;">${config.companyName} Pvt. Ltd. | ${config.companyAddress}<br>📞 ${config.supportPhone} | ✉️ ${config.supportEmail}</p></div>`;
    return sendMail(userEmail, `Loan Eligibility Check - ${config.companyName}`, html);
};

const sendProfessionalEnquiryConfirmation = async (userEmail, userName, enquiryType, details = {}) => {
    const branding = getBrandingHeader('20px');
    let detailsList = '';
    for (const [key, value] of Object.entries(details)) {
        if (value) {
            const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
            detailsList += `<p style="margin: 5px 0;"><b>${formattedKey}:</b> ${value}</p>`;
        }
    }
    const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #f1f5f9; border-radius: 16px;"><div style="text-align: center; margin-bottom: 30px;">${branding}</div><h2 style="color: #2c3e50;">Enquiry Received Successfully!</h2><p>Dear <b>${userName}</b>,</p><p>Thank you for reaching out to JV Overseas. We have received your enquiry regarding <b>${enquiryType}</b>.</p>${detailsList ? `<div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;"><h3 style="margin-top: 0; color: #495057;">Your Enquiry Details:</h3>${detailsList}</div>` : ''}<p>Our expert counselors will review your profile and contact you within <b>24 hours</b> to discuss the best options for your study abroad journey.</p><div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #0066cc;"><p style="margin: 0;"><b>What's Next?</b></p><ul style="margin: 10px 0; padding-left: 20px;"><li>Profile evaluation by our experts</li><li>Personalized university recommendations</li><li>Guidance on application process</li><li>Scholarship and loan assistance</li></ul></div><p>If you have any urgent questions, feel free to call us at <b>${config.supportPhone}</b>.</p><p style="margin-top: 30px;">Warm regards,<br><b>Team ${config.companyName}</b><br><i>Your Study Abroad Partner</i></p></div>`;
    return sendMail(userEmail, `Enquiry Confirmation - ${enquiryType}`, html);
};

const sendStudentRegistrationEmail = async (userEmail, userName, credentials, pdfBuffer) => {
    const branding = getBrandingHeader('22px');
    const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; color: #333; border: 1px solid #f1f5f9; border-radius: 20px;"><div style="text-align: center; margin-bottom: 30px;">${branding}</div><h2 style="color: #2c3e50; text-align: center;">Welcome to ${config.companyName}!</h2><p>Dear <b>${userName}</b>,</p><p>We are excited to have you on board! Your registration with ${config.companyName} has been successfully completed.</p><div style="background: #f0f4f8; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #d9e2ec;"><h3 style="margin-top: 0; color: #102a43; font-size: 16px; border-bottom: 2px solid #bbc7ce; padding-bottom: 10px; margin-bottom: 15px;">Your Student Portal Credentials</h3><p style="margin: 5px 0; font-size: 14px;"><b>URL:</b> <a href="${config.studentPortalUrl}" style="color: #0066cc;">Student Portal Login</a></p><div style="background: #fff; padding: 15px; border-radius: 4px; border: 1px dashed #bcccdc; margin-top: 10px;"><p style="margin: 5px 0; font-family: monospace; font-size: 16px;"><b>Username:</b> ${credentials.username}</p><p style="margin: 5px 0; font-family: monospace; font-size: 16px;"><b>Password:</b> ${credentials.password}</p></div><p style="font-size: 12px; color: #d64545; margin-top: 10px;"><b>Important:</b> Please login immediately and change your password.</p></div><p>We have also attached a <b>Registration Confirmation PDF</b> for your records.</p><p style="margin-top: 30px;">Best Regards,<br><b>Team ${config.companyName}</b></p></div>`;
    const attachments = pdfBuffer ? [{ filename: 'Registration_Confirmation.pdf', content: pdfBuffer, contentType: 'application/pdf' }] : [];
    return sendMail(userEmail, `Welcome to ${config.companyName} - Registration & Credentials`, { html, attachments });
};

const sendOTP = async (userEmail, userName, otp) => {
    const branding = getBrandingHeader('20px');
    const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #f1f5f9; border-radius: 16px;"><div style="text-align: center; margin-bottom: 30px;">${branding}</div><h2 style="color: #2c3e50; text-align: center;">Verification Code</h2><p>Hello <b>${userName}</b>,</p><p>You requested a security code for your ${config.companyName} account. Use the code below to proceed:</p><div style="background: #f8fafc; padding: 30px; text-align: center; border-radius: 12px; margin: 30px 0; border: 2px dashed #e2e8f0;"><span style="font-size: 32px; font-weight: 800; color: #2563eb; letter-spacing: 5px;">${otp}</span></div><p style="font-size: 13px; color: #64748b;">This code expires in 2 minutes. If you didn't request this, please ignore this email.</p></div>`;
    return sendMail(userEmail, `Security Code - ${config.companyName}`, html);
};

const sendEmployeeCreationOTP = async (userEmail, candidateName, otp) => {
    const branding = getBrandingHeader('22px', '#ffffff');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family: sans-serif; background: #f4f7fa; padding: 20px;"><div style="max-width: 600px; margin: auto; background: #fff; border-radius: 10px; overflow: hidden;"><div style="background: #1e293b; padding: 30px; text-align: center;">${branding}</div><div style="padding: 40px;"><h2>Verify Your Email</h2><p>Welcome to the team! Use the code below to complete your setup:</p><div style="background: #f8fafc; border: 2px dashed #cbd5e1; padding: 30px; text-align: center; font-size: 40px; font-weight: 900; color: #2563eb; letter-spacing: 10px; border-radius: 10px;">${otp}</div></div></div></body></html>`;
    return sendMail(userEmail, 'Action Required: Verify your employee account', html);
};

const sendEmployeeWelcomeEmail = async (userEmail, userName, password) => {
    const branding = getBrandingHeader('22px', '#ffffff');
    const loginUrl = `${config.crmUrl}/login`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family: sans-serif; background: #f4f7fa; padding: 20px;"><div style="max-width: 600px; margin: auto; background: #fff; border-radius: 10px; overflow: hidden;"><div style="background: #1e293b; padding: 30px; text-align: center;">${branding}</div><div style="padding: 40px;"><h2>Welcome Aboard, ${userName}!</h2><p>Your account has been created. Login below:</p><div style="background: #f0f9ff; padding: 25px; border-radius: 10px; margin-bottom: 20px;"><b>URL:</b> <a href="${loginUrl}">${loginUrl}</a><br><b>Username:</b> ${userEmail}<br><b>Password:</b> ${password}</div><p style="color: #ef4444;">Please change your password after logging in.</p></div></div></body></html>`;
    return sendMail(userEmail, 'Welcome to the Team - Your Credentials', html);
};

module.exports = {
    initTransporter,
    sendEligibilityConfirmation,
    sendProfessionalEnquiryConfirmation,
    sendStudentRegistrationEmail,
    sendOTP,
    sendEmployeeCreationOTP,
    sendEmployeeWelcomeEmail,
    sendEmail: (to, subject, html) => {
        return sendMail(to, subject, html);
    }
};
