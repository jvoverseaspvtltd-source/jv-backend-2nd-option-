const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const supabase = require('../config/supabaseClient');
const otpService = require('../services/otp.service');
const emailService = require('../services/email.service');
const auditService = require('../services/audit.service');
const imageService = require('../services/image.service');
const validationService = require('../services/validation.service');
const config = require('../config/env');
const logger = require('../utils/logger');
const { generateEmployeeId } = require('../utils/generators');
const { getCookieSecurityOptions } = require('../utils/cookieOptions');

// Helper to ensure profile URLs are absolute
const getFullImageUrl = (req, photoPath) => {
    if (!photoPath) return null;
    if (photoPath.startsWith('http')) return photoPath;

    // In production, always use https to avoid Mixed Content warnings
    const protocol = config.nodeEnv === 'production' ? 'https' : req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}${photoPath}`;
};

// STEP 1: EMAIL GATE (Pre-Authentication Layer)
exports.gate = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ msg: 'Email is required' });

    // 0. Domain Validation (Strict Company Policy)
    if (!validationService.validateCompanyEmail(email)) {
        logger.warn(`[GATE] Blocked non-company email: ${email}`);
        return res.status(401).json({ msg: 'Access Denied: Please use your official company email (@jvoversea.com)' });
    }

    const trimmedEmail = email.trim();
    logger.info(`[GATE] Attempt for: "${trimmedEmail}"`);

    try {
        // Fetch employee status only
        logger.info(`[GATE] Querying Supabase for ${trimmedEmail}...`);
        let { data: employee, error } = await supabase
            .from('employees')
            .select(`
                id, 
                status,
                locked_until
            `)
            .ilike('email', trimmedEmail)
            .maybeSingle();

        // Fallback for missing locked_until column (if SQL wasn't run)
        if (error && error.message.includes('locked_until')) {
            const { data: fallback, error: fallbackErr } = await supabase
                .from('employees')
                .select(`
                    id, 
                    status
                `)
                .eq('email', trimmedEmail)
                .maybeSingle();
            employee = fallback;
            error = fallbackErr;
            logger.info(`[GATE] Fallback result - Found: ${!!employee}, Error: ${fallbackErr?.message}`);
        } else {
            logger.info(`[GATE] Initial query succeeded. Found: ${!!employee}`);
        }

        if (error || !employee) {
            logger.warn(`[GATE] Unauthorized Access: Employee not found for ${trimmedEmail}`);
            auditService.logAction({
                action: 'AUTH_GATE_FAILURE',
                metadata: { email: trimmedEmail, reason: 'Identifier not found or error' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({ msg: 'Unauthorized Access' });
        }

        if (employee.status !== 'ACTIVE') {
            auditService.logAction({
                action: 'AUTH_GATE_FAILURE',
                metadata: { email: trimmedEmail, reason: 'Account inactive', status: employee.status },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({ msg: 'Unauthorized Access' });
        }

        // Check if account is locked
        if (employee.locked_until && new Date(employee.locked_until) > new Date()) {
            auditService.logAction({
                action: 'AUTH_GATE_FAILURE',
                metadata: { email: trimmedEmail, reason: 'Account locked' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({ msg: 'Unauthorized Access' });
        }

        // Log SUCCESS
        auditService.logAction({
            action: 'EMAIL_VERIFICATION_SUCCESS',
            metadata: { email: trimmedEmail },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        // Exact response format requested - NO DEPARTMENTS
        const gateResponse = {
            email_verified: true
        };

        logger.info(`[GATE] Success for ${trimmedEmail}. Returning: ${JSON.stringify(gateResponse)}`);
        res.json(gateResponse);
    } catch (err) {
        logger.error(`Gate error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * Request OTP for Employee Creation (Admin feature)
 */
exports.requestEmployeeCreationOtp = async (req, res) => {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ msg: 'Email is required' });

    const trimmedEmail = email.trim();

    try {
        // 1. Check if email is already registered to avoid wasting OTPs
        const { data: existing } = await supabase
            .from('employees')
            .select('id')
            .ilike('email', trimmedEmail)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({
                error: 'EMAIL_ALREADY_REGISTERED',
                msg: 'This email is already registered.'
            });
        }

        // 2. Generate random 6-digit OTP
        const otp = otpService.generateOTP(6);
        const salt = await bcrypt.genSalt(10);
        const otpHash = await bcrypt.hash(otp, salt);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

        // Store OTP in otp_logs
        const { error: otpError } = await supabase
            .from('otp_logs')
            .insert({
                email: trimmedEmail,
                otp_hash: otpHash,
                expires_at: expiresAt
            });

        if (otpError) throw otpError;

        // Send OTP via Email (Responsive Production Template)
        await emailService.sendEmployeeCreationOTP(trimmedEmail, name || 'New Employee', otp);

        logger.info(`[CREATION] OTP sent to ${email}`);
        res.json({ msg: 'Verification code sent to employee email' });
    } catch (err) {
        logger.error(`Request creation OTP error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to send verification code' });
    }
};

// STEP 2: LOGIN (Password-Based + Department Check)
exports.login = async (req, res) => {
    const { email, password, departmentCode } = req.body;

    // 0. Domain Validation (Strict Company Policy)
    if (!validationService.validateCompanyEmail(email)) {
        logger.warn(`[AUTH] Blocked non-company email login attempt: ${email}`);
        return res.status(401).json({ msg: 'Access Denied: Please use your official company email (@jvoversea.com)' });
    }

    try {
        // Find Employee with Role & Department
        let { data: employee, error } = await supabase
            .from('employees')
            .select(`
                id, email, password_hash, status, name, locked_until,
                departments(id, name, code),
                roles(id, name, permissions)
            `)
            .ilike('email', email.trim())
            .maybeSingle();

        // Use logger instead of console.log for production safety
        logger.debug(`Login attempt for ${email}. Found: ${!!employee}, Error: ${error?.message || 'none'}`);

        // Standardize extraction IMMEDIATELY
        if (employee) {
            employee.departments = Array.isArray(employee.departments) ? employee.departments[0] : employee.departments;
            employee.roles = Array.isArray(employee.roles) ? employee.roles[0] : employee.roles;
        }

        if (employee) {
            logger.debug(`Employee Dept: ${employee.departments?.code}, Role: ${employee.roles?.name}, Status: ${employee.status}`);
            logger.debug(`Target Dept: ${departmentCode}`);
        }

        // Fallback for missing locked_until column
        if (error && error.message.includes('locked_until')) {
            const { data: fallback, error: fallbackErr } = await supabase
                .from('employees')
                .select(`
                    id, email, password_hash, status, name,
                    departments(id, name, code),
                    roles(id, name, permissions)
                `)
                .ilike('email', email.trim())
                .maybeSingle();
            employee = fallback;
            error = fallbackErr;
        }

        // 1. Generic check for existence/status
        if (error || !employee) {
            logger.warn(`[AUTH] Login failed: User ${email} not found or database error:`, error?.message);
            auditService.logAction({
                action: 'AUTH_LOGIN_FAILURE',
                metadata: { email, reason: 'Identifier not found' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({ msg: 'Invalid login credentials. Please check your email or password and try again.' });
        }

        // Normalize department join (handle both array and object)
        const dept = Array.isArray(employee.departments) ? employee.departments[0] : employee.departments;
        const deptCode = dept?.code;

        logger.debug(`[AUTH] Login attempt: ${email} | Found Dept: ${deptCode} | Target Dept: ${departmentCode}`);

        if (employee.status !== 'ACTIVE') {
            logger.warn(`[AUTH] Login failed: User ${email} status is ${employee.status}`);
            auditService.logAction({
                action: 'AUTH_LOGIN_FAILURE',
                metadata: { email, reason: 'Account inactive' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({ msg: 'Invalid login credentials. Please check your email or password and try again.' });
        }

        // 2. Check Lockout
        if (employee.locked_until && new Date(employee.locked_until) > new Date()) {
            logger.warn(`[AUTH] Login failed: User ${email} is locked until ${employee.locked_until}`);
            auditService.logAction({
                action: 'AUTH_LOGIN_FAILURE',
                metadata: { email, reason: 'Account locked' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.status(401).json({ msg: 'Invalid login credentials. Please check your email or password and try again.' });
        }

        // 3. Department Verification (Relaxed/Warning)
        if (departmentCode && deptCode !== departmentCode) {
            logger.warn(`[AUTH] Department mismatch for ${email}. User is ${deptCode}, tried ${departmentCode}`);
        }

        // 4. Password Check
        const isMatch = await bcrypt.compare(password, employee.password_hash);
        if (!isMatch) {
            logger.warn(`[AUTH] Login failed: Password mismatch for ${email}`);
            return res.status(401).json({ msg: 'Invalid login credentials.' });
        }

        // 5. Department Info (Observation/Logging)
        if (departmentCode && employee.departments?.code !== departmentCode) {
            logger.warn(`[AUTH] Department mismatch for ${email}: Selected ${departmentCode}, Internal Dept ${employee.departments?.code}`);
        }

        // Audit Log Password Pass
        auditService.logAction({
            action: 'PASSWORD_VERIFICATION_SUCCESS',
            metadata: { email, dept: departmentCode },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        // Generate secure random OTP (NEVER hardcoded)
        const otp = otpService.generateOTP(6);
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 MINUTES

        // Invalidate any existing unverified OTPs for this email (login OTPs)
        const { data: existingCols } = await supabase.from('otp_logs').select('is_verified').limit(1);
        if (!existingCols?.error) {
            // Mark old unverified login OTPs as expired
            await supabase
                .from('otp_logs')
                .update({ is_verified: true })
                .eq('email', email.trim().toLowerCase())
                .eq('is_verified', false);
        }

        // Log OTP in development for easier testing (NEVER in production)
        if (config.nodeEnv === 'development') {
            logger.info(`[DEV] OTP Generated for ${email}: ${otp}`);
        }

        // Store OTP in otp_logs with proper initialization
        const { error: otpError } = await supabase
            .from('otp_logs')
            .insert({
                email: email.trim().toLowerCase(),
                otp_hash: otpHash,
                expires_at: expiresAt,
                attempts: 0,
                is_verified: false
            });

        if (otpError) throw otpError;

        // Send OTP via Email (Professional Template)
        const templateVars = {
            adminName: employee.name,
            otpCode: otp,
            email: employee.email,
            department: employee.departments.name,
            time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            ipAddress: req.ip || req.headers['x-forwarded-for'] || 'Unknown',
            companyName: 'JV Overseas'
        };

        const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <div style="text-align: center; border-bottom: 2px solid #0066cc; padding-bottom: 20px; margin-bottom: 20px;">
                <h2 style="color: #0066cc; margin: 0;">${templateVars.companyName}</h2>
                <p style="color: #666; font-size: 14px; margin-top: 5px;">Secure Employee Infrastructure</p>
            </div>
            
            <p>Hello <b>${templateVars.adminName}</b>,</p>
            <p>We received a login request for your account.</p>
            
            <div style="background-color: #f8f9fa; border-left: 5px solid #0066cc; padding: 20px; margin: 20px 0;">
                <p style="margin: 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Your One-Time Password</p>
                <h1 style="color: #333; font-size: 32px; letter-spacing: 5px; margin: 10px 0;">${templateVars.otpCode}</h1>
                <p style="margin: 0; color: #d9534f; font-size: 12px;">⏰ Valid for 2 minutes only</p>
            </div>

            <div style="font-size: 13px; color: #555; background: #fff; border: 1px solid #eee; padding: 15px; border-radius: 5px;">
                <p style="margin: 0 0 10px 0; font-weight: bold; border-bottom: 1px solid #eee; padding-bottom: 5px;">Login Details:</p>
                <p style="margin: 3px 0;">• <b>Email:</b> ${templateVars.email}</p>
                <p style="margin: 3px 0;">• <b>Department:</b> ${templateVars.department}</p>
                <p style="margin: 3px 0;">• <b>Time:</b> ${templateVars.time}</p>
                <p style="margin: 3px 0;">• <b>IP Address:</b> ${templateVars.ipAddress}</p>
            </div>

            <p style="color: #777; font-size: 13px; margin-top: 20px;">
                For your security:<br>
                • Do not share this OTP with anyone.<br>
                • Our team will never ask for your OTP.<br>
                • If you did not attempt this login, contact the administrator immediately.
            </p>

            <div style="border-top: 1px solid #eee; margin-top: 30px; padding-top: 20px; text-align: center; font-size: 12px; color: #999;">
                <p>Regards,<br>Security Team, ${templateVars.companyName}</p>
                <p>⚠️ This is an automated security message. Please do not reply.</p>
            </div>
        </div>
        `;

        // Send OTP email (best-effort). Do not block login on SMTP failure.
        try {
            await emailService.sendEmail(
                email,
                'Your One-Time Password (OTP) for CRM Login',
                emailHtml
            );
            auditService.logAction({
                action: 'OTP_SENT',
                metadata: { email },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
        } catch (emailErr) {
            logger.error(`Failed to send OTP email to ${email}: ${emailErr.message}`);
            // Continue without failing the request. OTP is logged in DEV; user can retry.
        }

        if (config.nodeEnv !== 'production') {
            logger.info(`[DEV] OTP for ${email}: ${otp}`);
        }

        // PRODUCTION SECURITY: OTP bypass is NEVER allowed in production
        if (config.skipOtp && config.nodeEnv !== 'production') {
            logger.warn(`[AUTH] OTP Bypassed for ${email} (SKIP_OTP enabled - DEV ONLY)`);
            return res.json({
                msg: 'OTP Bypassed',
                bypass: true,
                message: 'Testing mode: You can use any 6-digit code or just click verify if the UI allows.'
            });
        }

        // Ensure OTP was actually sent (email service initialized)
        if (!emailService) {
            logger.error(`[AUTH] Email service not initialized. Cannot send OTP to ${email}`);
            return res.status(500).json({ msg: 'Email service unavailable. Please contact support.' });
        }

        res.json({ msg: 'Second factor required. OTP sent.' });
    } catch (err) {
        logger.error(`Login error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// STEP 3: OTP VERIFICATION & TOKEN ISSUANCE (With Late Login Logic)
exports.verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    try {
        // Input validation
        if (!email || !otp) {
            return res.status(400).json({ msg: 'Email and OTP are required' });
        }

        const trimmedEmail = email.trim().toLowerCase();

        // Validate OTP format (must be numeric, 6 digits)
        if (!otpService.validateOTPFormat(otp, 6)) {
            logger.warn(`[AUTH] Invalid OTP format for ${trimmedEmail}: ${otp}`);
            return res.status(400).json({ msg: 'Invalid OTP format. Must be a 6-digit number.' });
        }

        // Fetch latest OTP for this email
        let query = supabase
            .from('otp_logs')
            .select('*')
            .eq('email', trimmedEmail);

        // Try to filter by is_verified if column exists
        const { data: colCheck } = await supabase.from('otp_logs').select('is_verified').limit(1);
        if (!colCheck?.error) {
            query = query.eq('is_verified', false);
        }

        const { data: logs, error: logError } = await query
            .order('created_at', { ascending: false })
            .limit(1);

        if (logError || !logs || logs.length === 0) {
            logger.warn(`[AUTH] No OTP request found for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'No OTP request found. Please request a new OTP.' });
        }

        const log = logs[0];

        // Check if OTP was already used
        if (log.is_verified) {
            logger.warn(`[AUTH] Attempted reuse of verified OTP for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'This OTP has already been used. Please request a new one.' });
        }

        // Check expiry
        if (otpService.isOTPExpired(log.expires_at)) {
            logger.warn(`[AUTH] Expired OTP attempt for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'OTP has expired. Please request a new one.' });
        }

        // Check attempts
        if (log.attempts >= 3) {
            logger.warn(`[AUTH] Max attempts reached for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'Too many failed attempts. Please request a new OTP.' });
        }

        // Verify OTP Hash
        const isMatch = await bcrypt.compare(otp.toString(), log.otp_hash);

        if (!isMatch) {
            const newAttempts = log.attempts + 1;

            // Increment attempts in otp_logs
            await supabase
                .from('otp_logs')
                .update({ attempts: newAttempts })
                .eq('id', log.id);

            await auditService.logAction({
                action: 'OTP_FAILURE',
                metadata: { email, reason: 'Invalid OTP', attempt: newAttempts },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            // If max attempts reached, lock the account
            if (newAttempts >= 3) {
                const lockoutMinutes = 15;
                const lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000).toISOString();

                await supabase
                    .from('employees')
                    .update({ locked_until: lockedUntil })
                    .eq('email', email);

                return res.status(403).json({ msg: `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.` });
            }

            return res.status(400).json({ msg: `Invalid OTP. ${3 - newAttempts} attempts remaining.` });
        }

        // Mark OTP as verified (CRITICAL: Prevent reuse)
        const { data: verCheck } = await supabase.from('otp_logs').select('is_verified').limit(1);
        if (!verCheck?.error) {
            await supabase
                .from('otp_logs')
                .update({ is_verified: true, attempts: (log.attempts || 0) + 1 })
                .eq('id', log.id);
        } else {
            // Fallback: Update attempts even if is_verified column doesn't exist
            await supabase
                .from('otp_logs')
                .update({ attempts: (log.attempts || 0) + 1 })
                .eq('id', log.id);
        }

        // Fetch Employee details for Token
        let { data: employee, error: empError } = await supabase
            .from('employees')
            .select(`
                id, email, name, profile_photo_url, department_id, is_admin,
                departments(code, name),
                roles(name, permissions),
                shift_start_time
            `)
            .ilike('email', email.trim())
            .single();

        // Safety Fallback for missing profile_photo_url or shift_start_time
        if (empError && (empError.message.includes('column') || empError.code === '42703')) {
            const { data: retryEmp, error: retryError } = await supabase
                .from('employees')
                .select(`
                    id, email, name, status, department_id, is_admin,
                    departments(code),
                    roles(name, permissions)
                `)
                .ilike('email', email.trim())
                .single();

            if (retryError) throw retryError;
            employee = retryEmp;
        } else if (empError) {
            throw empError;
        }

        // ==========================================
        // ⏰ PRO LATE LOGIN VALIDATION (CRITICAL)
        // ==========================================
        const GRACE_PERIOD_MINUTES = 10;
        const now = new Date();
        const currentTimeString = now.toLocaleTimeString('en-GB', { hour12: false }); // "14:30:00"

        // Default shift start 10:00 AM if not set
        const shiftStart = employee.shift_start_time || '10:00:00';

        // Simple Time Comparison (HH:MM:SS)
        const [shiftH, shiftM] = shiftStart.split(':').map(Number);
        const shiftDate = new Date();
        shiftDate.setHours(shiftH, shiftM, 0, 0);

        const graceLimit = new Date(shiftDate.getTime() + GRACE_PERIOD_MINUTES * 60000);

        // Extract Dept Code Safe
        const deptObjLate = Array.isArray(employee.departments) ? employee.departments[0] : employee.departments;
        const deptCodeLate = deptObjLate?.code;

        // Only run late check if NOT Admin AND IS WFH Department
        if (employee.roles?.name !== 'Super Admin' && deptCodeLate === 'WFH' && now > graceLimit) {
            // LATE DETECTED
            const diffMs = now - shiftDate;
            const lateMinutes = Math.floor(diffMs / 60000);

            // Check if approval request exists for TODAY
            const todayDate = now.toISOString().split('T')[0];
            const { data: lateReq } = await supabase
                .from('late_login_requests')
                .select('*')
                .eq('employee_id', employee.id)
                .eq('request_date', todayDate)
                .order('requested_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (!lateReq) {
                // CASE 1: First time detection -> Stop Login -> Show Confirmation
                return res.status(403).json({
                    code: 'LATE_LOGIN_REQUIRED',
                    msg: 'Late login detected. Admin approval required.',
                    data: {
                        shiftTime: shiftStart,
                        lateMinutes: lateMinutes,
                        gracePeriod: GRACE_PERIOD_MINUTES
                    }
                });
            }

            if (lateReq.status === 'PENDING') {
                // CASE 2: Request Pending
                return res.status(403).json({
                    code: 'APPROVAL_PENDING',
                    msg: 'Your late login request is pending approval.'
                });
            }

            if (lateReq.status === 'REJECTED') {
                // CASE 3: Rejected
                return res.status(403).json({
                    code: 'LOGIN_REJECTED',
                    msg: 'Your late login request was rejected. You cannot login today.'
                });
            }

            // CASE 4: APPROVED -> Allow login (Continue below)
            logger.info(`[AUTH] Late login APPROVED for ${email} (Late: ${lateMinutes}m)`);
        }

        // ==========================================
        // TOKEN GENERATION (Standard Flow)
        // ==========================================

        // Standardize Joined Data Extraction
        const deptObj = Array.isArray(employee.departments) ? employee.departments[0] : employee.departments;
        const deptCode = deptObj?.code || 'GUEST';

        // Helper to normalize role names
        const normalizeRole = (dbRoleName) => {
            if (!dbRoleName) return 'guest';
            const cleanName = dbRoleName.trim();
            const map = {
                'Super Administrator': 'super_admin',
                'Super Admin': 'super_admin',
                'Counsellor': 'counsellor',
                'Admission': 'admission',
                'Admission Officer': 'admission',
                'Work From Home': 'wfh',
                'Field Agent': 'field_agent'
            };
            return map[cleanName] || cleanName.toLowerCase().replace(/ /g, '_');
        };

        const roleObj = Array.isArray(employee.roles) ? employee.roles[0] : employee.roles;
        const roleNormalized = normalizeRole(roleObj?.name);

        // Generate Access Token (10 hours)
        const payload = {
            user: {
                id: employee.id,
                email: employee.email,
                name: employee.name,
                profile_photo_url: getFullImageUrl(req, employee.profile_photo_url),
                dept: deptCode,
                departmentId: employee.department_id,
                role: roleNormalized,
                permissions: roleObj?.permissions || {},
                is_first_login: employee.is_first_login,
                is_admin: employee.is_admin
            }
        };

        const secretKey = (deptCode || '').toUpperCase();
        const roleKey = (roleNormalized || '').toUpperCase();
        const jwtSecret = config.jwtSecrets[secretKey] || config.jwtSecrets[roleKey] || config.jwtSecret;

        const accessToken = jwt.sign(payload, jwtSecret, { expiresIn: '30m' });

        // Generate Refresh Token
        const refreshToken = jwt.sign({ id: employee.id, dept: deptCode }, jwtSecret, { expiresIn: '7d' });
        const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

        // Session Management: Enforce max 3 devices
        const { data: existingSessions } = await supabase
            .from('refresh_tokens')
            .select('id')
            .eq('employee_id', employee.id)
            .eq('is_revoked', false)
            .order('created_at', { ascending: true });

        if (existingSessions && existingSessions.length >= 3) {
            await supabase
                .from('refresh_tokens')
                .update({ is_revoked: true })
                .eq('id', existingSessions[0].id);
        }

        // Store New Refresh Token
        await supabase
            .from('refresh_tokens')
            .insert({
                employee_id: employee.id,
                token_hash: refreshTokenHash,
                ip_address: req.ip,
                user_agent: req.headers['user-agent'],
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });

        // Update employee's last login
        await supabase
            .from('employees')
            .update({
                last_login: new Date().toISOString(),
                ip_fingerprint: req.headers['user-agent']
            })
            .eq('id', employee.id);

        // Log Success
        await auditService.logAction({
            employeeId: employee.id,
            action: 'LOGIN_SUCCESS',
            metadata: { email, dept: deptCode },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        const { secure, sameSite } = getCookieSecurityOptions(req);
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure,
            sameSite,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ token: accessToken });
    } catch (err) {
        logger.error(`Verify OTP error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * Handle Late Login Request (Employee Action)
 * POST /api/admin/late-login-request
 */
exports.requestLateLogin = async (req, res) => {
    const { email, reason, lateMinutes, shiftTime } = req.body;

    try {
        const { data: employee } = await supabase
            .from('employees')
            .select('id, department_id')
            .eq('email', email)
            .single();

        if (!employee) return res.status(404).json({ msg: 'Employee not found' });

        const { data, error } = await supabase
            .from('late_login_requests')
            .insert({
                employee_id: employee.id,
                department_id: employee.department_id,
                shift_time: shiftTime || '10:00:00',
                actual_login_time: new Date().toISOString(),
                late_minutes: lateMinutes,
                reason: reason,
                status: 'PENDING'
            })
            .select()
            .single();

        if (error) {
            // Fallback if table doesn't exist yet
            if (error.code === '42P01') {
                return res.status(500).json({ msg: 'Late login system not yet initialized (DB migration needed).' });
            }
            throw error;
        }

        res.json({ msg: 'Late login request submitted. Waiting for Admin approval.', requestId: data.id });
    } catch (err) {
        logger.error(`Late Login Request Error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

/**
 * Admin Action: Approve/Reject Late Login
 * POST /api/admin/late-requests/:id/action
 */
exports.manageLateLogin = async (req, res) => {
    const { action, remarks } = req.body; // 'APPROVE' or 'REJECT'
    const requestId = req.params.id;
    const adminId = req.user.id; // From auth middleware

    try {
        const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        const { data, error } = await supabase
            .from('late_login_requests')
            .update({
                status: status,
                action_by: adminId,
                action_at: new Date().toISOString(),
                admin_remarks: remarks
            })
            .eq('id', requestId)
            .select()
            .single();

        if (error) throw error;

        // Log Audit
        await auditService.logAction({
            employeeId: adminId,
            action: `LATE_LOGIN_${status}`,
            metadata: { requestId, employee: data.employee_id, remarks },
            ip: req.ip
        });

        res.json({ msg: `Late login request ${status}`, request: data });
    } catch (err) {
        logger.error(`Manage Late Login Error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

/**
 * Fetch Pending Late Requests (Admin Panel)
 * GET /api/admin/late-requests
 */
exports.getPendingLateRequests = async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('late_login_requests')
            .select(`
                *,
                employee:employees(name, email, departments(name))
            `)
            .eq('request_date', today)
            .eq('status', 'PENDING')
            .order('requested_at', { ascending: false });

        if (error) throw error;

        res.json(data);
    } catch (err) {
        logger.error(`Get Pending Late Requests Error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

/**
 * REFRESH TOKEN - Implements Token Rotation & Security Verification
 */
exports.refreshToken = async (req, res) => {
    const oldRefreshToken = req.cookies?.refreshToken;

    if (!oldRefreshToken) {
        return res.status(401).json({ msg: 'No refresh token provided' });
    }

    try {
        // 1. Decode token to find user identity (secret is dept-specific)
        const decoded = jwt.decode(oldRefreshToken);
        if (!decoded || !decoded.id) {
            return res.status(401).json({ msg: 'Invalid refresh token' });
        }

        // 2. Fetch Employee details to get correct secret & permissions
        const { data: employee, error: empError } = await supabase
            .from('employees')
            .select(`
                id, email, name, status, department_id, is_admin,
                departments(code, name),
                roles(name, permissions)
            `)
            .eq('id', decoded.id)
            .single();

        if (empError || !employee || employee.status !== 'ACTIVE') {
            return res.status(403).json({ msg: 'Account inactive or not found' });
        }

        // 3. Resolve Secret
        const deptObj = Array.isArray(employee.departments) ? employee.departments[0] : employee.departments;
        const deptCode = deptObj?.code || 'GUEST';
        const roleObj = Array.isArray(employee.roles) ? employee.roles[0] : employee.roles;

        // Helper to normalize role names for frontend (moved inside or reused)
        const normalizeRole = (dbRoleName) => {
            if (!dbRoleName) return 'guest';
            const cleanName = dbRoleName.trim();
            const map = {
                'Super Administrator': 'super_admin',
                'Super Admin': 'super_admin',
                'Counsellor': 'counsellor',
                'Admission': 'admission',
                'Admission Officer': 'admission',
                'Work From Home': 'wfh',
                'Field Agent': 'field_agent'
            };
            return map[cleanName] || cleanName.toLowerCase().replace(/ /g, '_');
        };

        const roleNormalized = normalizeRole(roleObj?.name);
        const secretKey = (deptCode || '').toUpperCase();
        const roleKey = (roleNormalized || '').toUpperCase();
        const jwtSecret = config.jwtSecrets[secretKey] || config.jwtSecrets[roleKey] || config.jwtSecret;

        // 4. Verify Signature
        let verified;
        try {
            verified = jwt.verify(oldRefreshToken, jwtSecret);
        } catch (jwtErr) {
            logger.warn(`[AUTH] Refresh token verification failed: ${jwtErr.message}`);
            return res.status(401).json({ msg: 'Session expired' });
        }

        // 5. Verify against DB (Rotation Check)
        const { data: session, error: sessionError } = await supabase
            .from('refresh_tokens')
            .select('*')
            .eq('employee_id', employee.id)
            .eq('is_revoked', false)
            .order('created_at', { ascending: false });

        if (sessionError || !session) {
            return res.status(401).json({ msg: 'No active session found' });
        }

        // Check if this specific token hash exists and is valid
        // NOTE: Brute force check of hashes is slow but secure. 
        // A better way is to store a unique session ID in the token. 
        // For now, let's find the matching hash.
        let matchingSession = null;
        for (const s of session) {
            const isMatch = await bcrypt.compare(oldRefreshToken, s.token_hash);
            if (isMatch) {
                matchingSession = s;
                break;
            }
        }

        if (!matchingSession) {
            logger.warn(`[SECURITY] Refresh Token reuse detected for user ${employee.email}. Revoking all sessions.`);
            // REUSE DETECTION: Token is valid but not found in active DB records -> it was already rotated.
            // This is a sign of a replay attack. Revoke EVERYTHING for this user.
            await supabase
                .from('refresh_tokens')
                .update({ is_revoked: true })
                .eq('employee_id', employee.id);

            return res.status(401).json({ msg: 'Security breach detected. Please login again.' });
        }

        // 6. ROTATION: Revoke old token, issue new one
        await supabase
            .from('refresh_tokens')
            .update({ is_revoked: true })
            .eq('id', matchingSession.id);

        // Generate New Access Token
        const payload = {
            user: {
                id: employee.id,
                email: employee.email,
                name: employee.name,
                dept: deptCode,
                departmentId: employee.department_id,
                role: roleNormalized,
                permissions: roleObj?.permissions || {},
                is_admin: employee.is_admin
            }
        };
        const accessToken = jwt.sign(payload, jwtSecret, { expiresIn: '30m' });

        // Generate New Refresh Token
        const newRefreshToken = jwt.sign({ id: employee.id, dept: deptCode }, jwtSecret, { expiresIn: '7d' });
        const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);

        await supabase
            .from('refresh_tokens')
            .insert({
                employee_id: employee.id,
                token_hash: newRefreshTokenHash,
                ip_address: req.ip,
                user_agent: req.headers['user-agent'],
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });

        // Set New Refresh Token in Cookie
        const { secure, sameSite } = getCookieSecurityOptions(req);
        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure,
            sameSite,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ token: accessToken });
    } catch (err) {
        logger.error(`Refresh token error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// LOGOUT
exports.logout = async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    try {
        if (refreshToken) {
            // Revoke specific session or all sessions
            // Since we've switched to rotation, we can find the matching session and revoke it
            // Or just revoke all for this user for maximum security on explicit logout
            if (req.user) {
                await supabase
                    .from('refresh_tokens')
                    .update({ is_revoked: true })
                    .eq('employee_id', req.user.id);

                logger.info(`[AUTH] User ${req.user.email} logged out. All sessions revoked.`);
            }
        }

        res.clearCookie('refreshToken');
        res.json({ msg: 'Logged out successfully' });
    } catch (err) {
        logger.error(`Logout error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// CRM APIS (Refactored for Enterprise Schema)

// @route   GET api/admin/leads
exports.getLeads = async (req, res) => {
    try {
        const { data: leads, error } = await supabase
            .from('leads')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Map to camelCase for frontend compatibility
        const mappedLeads = leads.map(lead => ({
            _id: lead.id,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            serviceType: lead.service_type,
            source: lead.source,
            status: lead.status,
            details: lead.details,
            university: lead.university,
            preferredCountry: lead.preferred_country,
            isAssigned: lead.is_assigned,
            assignedTo: lead.assigned_to,
            createdAt: lead.created_at
        }));

        res.json(mappedLeads);
    } catch (err) {
        logger.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/admin/enquiries
// @desc    Get enquiries (status = 'ENQUIRY_RECEIVED')
exports.getEnquiries = async (req, res) => {
    try {
        const { data: enquiries, error } = await supabase
            .from('leads')
            .select('*')
            .eq('status', 'ENQUIRY_RECEIVED')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Map to camelCase
        const mappedEnquiries = enquiries.map(lead => ({
            _id: lead.id,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            serviceType: lead.service_type,
            source: lead.source,
            status: lead.status,
            details: lead.details,
            university: lead.university,
            preferredCountry: lead.preferred_country,
            isAssigned: lead.is_assigned,
            assignedTo: lead.assigned_to,
            createdAt: lead.created_at
        }));

        res.json(mappedEnquiries);
    } catch (err) {
        logger.error(`getEnquiries Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/admin/eligibility-records
// @desc    Get all eligibility records with lead details
// @access  Admin only (Super Admin, Counselor Admin, WFH Admin)
exports.getEligibilityRecords = async (req, res) => {
    try {
        const { data: records, error } = await supabase
            .from('eligibility_records')
            .select(`
                *,
                leads (
                    id,
                    name,
                    email,
                    phone,
                    service_type,
                    status,
                    assigned_to,
                    created_at
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const mappedRecords = records.map(record => ({
            _id: record.id,
            leadId: record.lead_id,
            studentDetails: record.student_details,
            academics: record.academics,
            courseDetails: record.course_details,
            testScores: record.test_scores,
            loanRequirement: record.loan_requirement,
            coApplicant: record.co_applicant,
            collateral: record.collateral,
            additionalInfo: record.additional_info,
            analysis: record.analysis,
            createdAt: record.created_at,
            lead: record.leads ? {
                id: record.leads.id,
                name: record.leads.name,
                email: record.leads.email,
                phone: record.leads.phone,
                serviceType: record.leads.service_type,
                status: record.leads.status,
                assignedTo: record.leads.assigned_to,
                createdAt: record.leads.created_at
            } : null
        }));

        res.json(mappedRecords);
    } catch (err) {
        logger.error(`Get eligibility records error: `);
        res.status(500).send('Server Error');
    }
};
// ============================================================================
// SUPER ADMIN DASHBOARD OPS
// ============================================================================

// Simple In-Memory Cache for Stats (5 Minutes TTL)
let systemStatsCache = {
    data: null,
    lastFetch: 0,
    TTL: 5 * 60 * 1000 // 5 Minutes
};

// @route   GET api/admin/stats/system
// @desc    High-level system health counters (Cached)
exports.getSystemStats = async (req, res) => {
    try {
        // 1. Check Cache
        const now = Date.now();
        if (systemStatsCache.data && (now - systemStatsCache.lastFetch < systemStatsCache.TTL)) {
            // Return cached data
            return res.json({
                ...systemStatsCache.data,
                _cached: true, // internal flag for debugging
                _cachedTime: new Date(systemStatsCache.lastFetch).toISOString()
            });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIso = today.toISOString();

        // Check for locked_until column dynamically
        const { data: lockedCheck } = await supabase.from('employees').select('locked_until').limit(1);
        const hasLockedUntil = !lockedCheck?.error;

        // Parallel Requests for Performance
        const [
            { count: totalEmployees },
            { count: activeEmployees },
            { count: lockedAccounts },
            { count: failedLogins },
            { count: otpFailures },
            { count: activeSessions }
        ] = await Promise.all([
            // ... (rest of the query logic remains same, but we need to capture the result at the end)
            // 1. Total Employees
            supabase.from('employees').select('id', { count: 'exact', head: true }),

            // 2. Active Employees
            supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),

            // 3. Locked Accounts (conditional)
            hasLockedUntil
                ? supabase.from('employees').select('id', { count: 'exact', head: true }).gt('locked_until', new Date().toISOString())
                : Promise.resolve({ count: 0 }),

            // 4. Failed Logins Today
            supabase.from('audit_logs')
                .select('id', { count: 'exact', head: true })
                .eq('action', 'LOGIN_FAILURE')
                .gt('created_at', todayIso),

            // 5. OTP Failures Today
            supabase.from('audit_logs')
                .select('id', { count: 'exact', head: true })
                .eq('action', 'OTP_FAILURE')
                .gt('created_at', todayIso),

            // 6. Active Sessions (Valid refresh tokens)
            supabase.from('refresh_tokens')
                .select('id', { count: 'exact', head: true })
                .eq('is_revoked', false)
                .gt('expires_at', new Date().toISOString())
        ]);

        const responseData = {
            totalEmployees: totalEmployees || 0,
            activeEmployees: activeEmployees || 0,
            lockedAccounts: lockedAccounts || 0,
            securityAlerts: {
                failedLogins: failedLogins || 0,
                otpFailures: otpFailures || 0
            },
            activeSessions: activeSessions || 0,
            systemHealth: 'HEALTHY',
            timestamp: new Date()
        };

        // Update Cache
        systemStatsCache.data = responseData;
        systemStatsCache.lastFetch = Date.now();

        res.json(responseData);

    } catch (err) {
        logger.error(`System Stats Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/admin/stats/departments
// @desc    Breakdown of employees per department
exports.getDepartmentStats = async (req, res) => {
    try {
        // Fetch specific departments we care about (System Depts)
        const { data: stats, error } = await supabase
            .from('employees')
            .select(`
            status,
            departments!inner(name, code)
        `);

        if (error) throw error;

        // Aggregate in Memory (Efficient for < 1000 employees)
        const summary = {};

        stats.forEach(emp => {
            const deptName = emp.departments.name;
            if (!summary[deptName]) {
                summary[deptName] = { total: 0, active: 0, locked: 0, code: emp.departments.code };
            }

            summary[deptName].total++;
            if (emp.status === 'ACTIVE') summary[deptName].active++;

            // Note: locked_until column doesn't exist yet, so locked count will always be 0
            // This can be updated once the column is added to the database
        });

        // Convert to array
        const result = Object.entries(summary).map(([name, data]) => ({
            name,
            ...data
        }));

        res.json(result);
    } catch (err) {
        logger.error(`Dept Stats Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * @route   GET api/admin/monitoring/performance
 * @desc    Get employee-wise lead performance metrics
 * @access  Admin/Super Admin
 */
exports.getPerformanceStats = async (req, res) => {
    try {
        const { dateFrom, dateTo, departmentId } = req.query;
        // Default to today
        const now = new Date();
        const start = dateFrom ? new Date(dateFrom) : new Date(new Date().setHours(0, 0, 0, 0));
        const end = dateTo ? new Date(dateTo) : new Date();

        // 1. Fetch relevant employees (Active counsellors, admission, wfh)
        let empQuery = supabase.from('employees')
            .select('id, name, employee_id, department_id, roles(name)')
            .eq('status', 'ACTIVE');

        if (req.user.role?.toLowerCase() !== 'super_admin') {
            const deptId = req.user.departmentId || req.user.department_id;
            if (deptId) {
                empQuery = empQuery.eq('department_id', deptId);
            } else {
                logger.warn(`[PERF] No department ID found for user ${req.user.email} - attempting lookup`);
                const { data: self } = await supabase.from('employees').select('department_id').eq('id', req.user.id).single();
                if (self?.department_id) empQuery = empQuery.eq('department_id', self.department_id);
            }
        } else if (departmentId) {
            empQuery = empQuery.eq('department_id', departmentId);
        }

        const { data: employees, error: empError } = await empQuery;
        if (empError) throw empError;

        // Filter out Super Admins from the results (if any)
        const teamEmployees = employees.filter(emp => {
            const roleName = (Array.isArray(emp.roles) ? emp.roles[0] : emp.roles)?.name?.toLowerCase();
            return roleName !== 'super administrator' && roleName !== 'super_admin';
        });

        if (!teamEmployees || teamEmployees.length === 0) return res.json([]);

        const employeeIds = teamEmployees.map(e => e.id);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        // 2. Fetch all required metrics in parallel
        const metricsPromises = [
            // Total Assigned in range
            supabase.from('leads').select('assigned_to')
                .in('assigned_to', employeeIds)
                .gte('assigned_at', start.toISOString())
                .lte('assigned_at', end.toISOString()),

            // Call Logs (audit_logs for interaction)
            supabase.from('audit_logs').select('employee_id')
                .eq('action', 'LEAD_INTERACTION')
                .in('employee_id', employeeIds)
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()),

            // Converted Leads in range (Using Audit Logs for precision)
            supabase.from('audit_logs').select('employee_id')
                .in('employee_id', employeeIds)
                .eq('action', 'LEAD_CONVERTED')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()),

            // Currently Pending Total (Across all time)
            supabase.from('leads').select('assigned_to')
                .in('assigned_to', employeeIds)
                .not('status', 'in', '(REJECTED,CONVERTED,Registered)')
        ];

        const results = await Promise.all(metricsPromises);

        // Check for any query errors
        results.forEach((res, idx) => {
            if (res.error) {
                logger.error(`Query ${idx} failed in Performance Stats:`, res.error);
                throw new Error(`Metric query ${idx} failed: ${res.error.message}`);
            }
        });

        const [
            { data: assignedLeads },
            { data: interactions },
            { data: convertedLeads },
            { data: pendingLeads }
        ] = results;

        // 3. Aggregate results per employee
        const report = teamEmployees.map(emp => {
            const empAssigned = assignedLeads.filter(l => l.assigned_to === emp.id).length;
            const empCalls = interactions.filter(i => i.employee_id === emp.id).length;
            const empConverted = convertedLeads.filter(l => l.employee_id === emp.id).length;
            const empPending = pendingLeads.filter(l => l.assigned_to === emp.id).length;

            return {
                id: emp.id,
                name: emp.name,
                employeeId: emp.employee_id,
                role: (Array.isArray(emp.roles) ? emp.roles[0] : emp.roles)?.name || 'Counsellor',
                metrics: {
                    assigned: empAssigned,
                    calls: empCalls,
                    converted: empConverted,
                    pending: empPending
                }
            };
        });

        res.json(report);
    } catch (err) {
        logger.error(`getPerformanceStats Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * @route   GET api/admin/monitoring/follow-ups
 * @desc    Get employee-wise follow-up tracking
 * @access  Admin/Super Admin
 */
exports.getFollowUpMonitoring = async (req, res) => {
    try {
        const { departmentId } = req.query;

        // 1. Fetch relevant employees
        let empQuery = supabase.from('employees')
            .select('id, name, employee_id, roles(name)')
            .eq('status', 'ACTIVE');

        if (req.user.role?.toLowerCase() !== 'super_admin') {
            const deptId = req.user.departmentId || req.user.department_id;
            if (deptId) {
                empQuery = empQuery.eq('department_id', deptId);
            } else {
                logger.warn(`[FOLLOWUP] No department ID found for user ${req.user.email} - attempting lookup`);
                const { data: self } = await supabase.from('employees').select('department_id').eq('id', req.user.id).single();
                if (self?.department_id) empQuery = empQuery.eq('department_id', self.department_id);
            }
        } else if (departmentId) {
            empQuery = empQuery.eq('department_id', departmentId);
        }
        const { data: employees, error: empError } = await empQuery;
        if (empError) throw empError;

        const teamEmployees = employees.filter(emp => {
            const roleName = (Array.isArray(emp.roles) ? emp.roles[0] : emp.roles)?.name?.toLowerCase();
            return roleName !== 'super administrator' && roleName !== 'super_admin';
        });

        if (!teamEmployees || teamEmployees.length === 0) return res.json([]);

        const employeeIds = teamEmployees.map(e => e.id);

        // 2. Fetch leads with follow_ups for these employees
        const { data: leads, error: leadError } = await supabase
            .from('leads')
            .select('assigned_to, follow_ups')
            .in('assigned_to', employeeIds)
            .not('follow_ups', 'is', null);

        if (leadError) throw leadError;

        const now = new Date();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 3. Calculate metrics in memory
        const report = teamEmployees.map(emp => {
            const empLeads = leads.filter(l => l.assigned_to === emp.id);
            let pending = 0;
            let overdue = 0;
            let completedToday = 0;
            let upcoming = 0;

            empLeads.forEach(lead => {
                (lead.follow_ups || []).forEach(f => {
                    const fDate = new Date(f.date);
                    if (f.status === 'PENDING') {
                        pending++;
                        if (fDate < todayStart) {
                            overdue++;
                        } else {
                            upcoming++;
                        }
                    } else if (f.status === 'COMPLETED' && f.completedAt) {
                        const compDate = new Date(f.completedAt);
                        if (compDate >= todayStart) {
                            completedToday++;
                        }
                    }
                });
            });

            return {
                id: emp.id,
                name: emp.name,
                employeeId: emp.employee_id,
                role: (Array.isArray(emp.roles) ? emp.roles[0] : emp.roles)?.name || 'Counsellor',
                metrics: {
                    pending,
                    overdue,
                    upcoming,
                    completedToday
                }
            };
        });

        res.json(report);
    } catch (err) {
        logger.error(`getFollowUpMonitoring Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * @route   GET api/admin/monitoring/employee/:id
 * @desc    Get detailed performance telemetry for a single employee
 * @access  Admin/Super Admin
 */
exports.getEmployeeMonitoring = async (req, res) => {
    try {
        const { id } = req.params;
        const { dateFrom, dateTo } = req.query;

        // 1. Authorization Check
        // Super Admin can see everyone. Dept Admin can only see their own department.
        const { data: targetEmployee, error: targetError } = await supabase
            .from('employees')
            .select('id, name, employee_id, department_id, roles(name)')
            .eq('id', id)
            .single();

        if (targetError || !targetEmployee) {
            return res.status(404).json({ msg: 'Employee not found' });
        }

        if (req.user.role?.toLowerCase() !== 'super_admin') {
            const userDeptId = req.user.departmentId || req.user.department_id;
            if (targetEmployee.department_id !== userDeptId) {
                return res.status(403).json({ msg: 'Access denied: Department mismatch' });
            }
        }

        // 2. Metrics Logic
        const start = dateFrom ? new Date(dateFrom) : new Date(new Date().setDate(new Date().getDate() - 30));
        const end = dateTo ? new Date(dateTo) : new Date();
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        const metricsPromises = [
            supabase.from('leads').select('id', { count: 'exact' })
                .eq('assigned_to', id)
                .gte('assigned_at', start.toISOString())
                .lte('assigned_at', end.toISOString()),

            supabase.from('audit_logs').select('id', { count: 'exact' })
                .eq('employee_id', id)
                .eq('action', 'LEAD_INTERACTION')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()),

            supabase.from('audit_logs').select('id', { count: 'exact' })
                .eq('employee_id', id)
                .eq('action', 'LEAD_CONVERTED')
                .gte('created_at', start.toISOString())
                .lte('created_at', end.toISOString()),

            supabase.from('leads').select('follow_ups')
                .eq('assigned_to', id)
                .not('follow_ups', 'is', null)
        ];

        const results = await Promise.all(metricsPromises);
        const [
            { count: assignedCount },
            { count: interactionCount },
            { count: convertedCount },
            { data: leadsWithFollowUps }
        ] = results;

        let pending = 0;
        let overdue = 0;
        let upcoming = 0;
        const now = new Date();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        leadsWithFollowUps?.forEach(lead => {
            (lead.follow_ups || []).forEach(f => {
                if (f.status === 'PENDING') {
                    pending++;
                    if (new Date(f.date) < todayStart) overdue++;
                    else upcoming++;
                }
            });
        });

        res.json({
            employee: {
                id: targetEmployee.id,
                name: targetEmployee.name,
                employeeId: targetEmployee.employee_id,
                role: (Array.isArray(targetEmployee.roles) ? targetEmployee.roles[0] : targetEmployee.roles)?.name || 'Counsellor'
            },
            performance: {
                assigned: assignedCount || 0,
                interactions: interactionCount || 0,
                converted: convertedCount || 0,
                yield: assignedCount > 0 ? ((convertedCount / assignedCount) * 100).toFixed(1) : 0
            },
            followUpHealth: {
                totalPending: pending,
                overdue: overdue,
                upcoming: upcoming
            },
            period: {
                from: start.toISOString(),
                to: end.toISOString()
            }
        });
    } catch (err) {
        logger.error(`getEmployeeMonitoring Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};


// @route   GET api/admin/audit-logs
// @desc    Read-only stream of security events
exports.getAuditLogs = async (req, res) => {
    try {
        const { limit = 50 } = req.query;

        const { data: logs, error } = await supabase
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (error) throw error;

        res.json(logs);
    } catch (err) {
        logger.error(`Audit Logs Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/admin/sessions
// @desc    Monitor active user sessions
exports.getActiveSessions = async (req, res) => {
    try {
        // improved query to join employee details
        const { data: sessions, error } = await supabase
            .from('refresh_tokens')
            .select(`
            id,
            ip_address,
            user_agent,
            created_at,
            expires_at,
            employees!inner(name, email, departments(name))
        `)
            .eq('is_revoked', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false });

        if (error) throw error;

        const formatted = sessions.map(s => ({
            sessionId: s.id,
            user: s.employees.name,
            email: s.employees.email,
            department: s.employees.departments?.name,
            ip: s.ip_address,
            device: s.user_agent, // Frontend can parse this further if needed
            loginTime: s.created_at,
            expiresAt: s.expires_at
        }));

        res.json(formatted);
    } catch (err) {
        logger.error(`Session Monitor Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// PROFILE MANAGEMENT
// ============================================================================

const normalizeAuthData = (employee) => {
    const dObj = Array.isArray(employee.departments) ? employee.departments[0] : employee.departments;
    const rObj = Array.isArray(employee.roles) ? employee.roles[0] : employee.roles;

    // Normalize Role Slug
    let roleName = rObj?.name || 'guest';
    const normalizedRole = roleName.toLowerCase().trim().replace(/ /g, '_')
        .replace('administrator', 'admin'); // Handle "Super Administrator"

    return {
        department: dObj?.name,
        departmentCode: dObj?.code,
        departmentId: employee.department_id,
        role: normalizedRole,
        roleName: roleName // Keep display name separate if needed
    };
};

// @route   GET api/admin/profile
// @desc    Get current admin profile
exports.getProfile = async (req, res) => {
    try {
        let selectStr = `
            id, employee_id, name, email, phone, status, profile_photo_url, 
            department_id, created_at, last_profile_updated_at,
            dob, bio, gender, address, emergency_contact,
            departments(name, code), roles(name)
        `;

        const { data: employee, error } = await supabase
            .from('employees')
            .select(selectStr)
            .eq('id', req.user.id)
            .maybeSingle();

        if (error) {
            logger.warn(`Initial profile fetch failed: ${error.message}. Attempting fallback...`);

            const { data: fb1, error: err1 } = await supabase
                .from('employees')
                .select(`
                    id, employee_id, name, email, phone, status, profile_photo_url, 
                    department_id, created_at,
                    departments(name, code), roles(name)
                `)
                .eq('id', req.user.id)
                .maybeSingle();

            if (fb1) {
                const normalized = normalizeAuthData(fb1);
                return res.json({
                    id: fb1.id,
                    employeeId: fb1.employee_id,
                    name: fb1.name,
                    email: fb1.email,
                    phone: fb1.phone,
                    status: fb1.status,
                    profilePhoto: getFullImageUrl(req, fb1.profile_photo_url),
                    ...normalized,
                    joinedAt: fb1.created_at,
                    _warning: 'Partial profile loaded. Run migration 013 to see all fields.'
                });
            }
            throw err1;
        }

        if (!employee) {
            return res.status(404).json({ msg: 'User profile not found. Please log out and login again.' });
        }

        const authData = normalizeAuthData(employee);

        res.json({
            id: employee.id,
            employeeId: employee.employee_id,
            name: employee.name,
            email: employee.email,
            phone: employee.phone,
            status: employee.status,
            dob: employee.dob,
            bio: employee.bio,
            gender: employee.gender,
            address: employee.address,
            emergencyContact: employee.emergency_contact,
            profilePhoto: getFullImageUrl(req, employee.profile_photo_url),
            profile_photo_url: employee.profile_photo_url,
            ...authData,
            joinedAt: employee.created_at,
            lastProfileUpdate: employee.last_profile_updated_at
        });
    } catch (err) {
        logger.error(`Get Profile Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   PUT api/admin/profile
// @desc    Update employee profile details
exports.updateProfile = async (req, res) => {
    try {
        const { name, dob, bio, gender, address, emergencyContact, phone } = req.body;

        // Basic validation
        if (name && name.trim().length < 2) {
            return res.status(400).json({ msg: 'Name must be at least 2 characters' });
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (dob) updateData.dob = dob;
        if (bio !== undefined) updateData.bio = bio;
        if (gender) updateData.gender = gender;
        if (address !== undefined) updateData.address = address;
        if (emergencyContact !== undefined) updateData.emergency_contact = emergencyContact;
        if (phone) {
            if (!validationService.validatePhone(phone)) {
                return res.status(400).json({ msg: 'Phone number must be exactly 10 digits' });
            }
            updateData.phone = phone;
        }

        // Update timestamp
        updateData.last_profile_updated_at = new Date().toISOString();

        const { error } = await supabase
            .from('employees')
            .update(updateData)
            .eq('id', req.user.id);

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'PROFILE_UPDATED',
            metadata: {
                updatedFields: Object.keys(updateData)
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        const { data: updatedUser } = await supabase
            .from('employees')
            .select(`
                id, employee_id, name, email, phone, status, profile_photo_url, 
                department_id, dob, bio, gender, address, emergency_contact,
                departments(name, code), roles(name)
            `)
            .eq('id', req.user.id)
            .single();

        res.json({
            msg: 'Profile updated successfully',
            updatedFields: Object.keys(updateData),
            user: {
                ...updatedUser,
                profilePhoto: getFullImageUrl(req, updatedUser.profile_photo_url)
            }
        });
    } catch (err) {
        logger.error(`Update Profile Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/admin/profile/photo
// @desc    Upload profile photo
exports.uploadProfilePhoto = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ msg: 'No file uploaded' });
        }

        // Get current profile photo to delete later
        const { data: currentProfile, error: fetchError } = await supabase
            .from('employees')
            .select('profile_photo_url')
            .eq('id', req.user.id)
            .single();

        if (fetchError) {
            if (fetchError.message.includes('profile_photo_url')) {
                return res.status(400).json({
                    msg: 'Storage for profile photos is not yet enabled in the database. Please run the SQL command: ALTER TABLE employees ADD COLUMN profile_photo_url TEXT;'
                });
            }
            throw fetchError;
        }

        // Process and save new photo
        const photoData = await imageService.processProfilePhoto(
            req.file.buffer,
            req.file.originalname
        );

        // Update database
        const { error } = await supabase
            .from('employees')
            .update({ profile_photo_url: photoData.path })
            .eq('id', req.user.id);

        if (error) throw error;

        // Delete old photo if exists
        if (currentProfile?.profile_photo_url) {
            await imageService.deleteProfilePhoto(currentProfile.profile_photo_url);
        }

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'PROFILE_PHOTO_UPDATED',
            metadata: {
                filename: photoData.filename,
                size: `${Math.round(photoData.size / 1024)}KB`
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            msg: 'Profile photo uploaded successfully',
            photoUrl: getFullImageUrl(req, photoData.path),
            profilePhoto: getFullImageUrl(req, photoData.path),
            size: photoData.size
        });
    } catch (err) {
        logger.error(`Upload Photo Error: ${err.message}`);
        res.status(500).json({ msg: err.message || 'Server Error' });
    }
};

// @route   DELETE api/admin/profile/photo
// @desc    Remove profile photo
exports.removeProfilePhoto = async (req, res) => {
    try {
        // Get current profile photo
        const { data: currentProfile, error: fetchError } = await supabase
            .from('employees')
            .select('profile_photo_url')
            .eq('id', req.user.id)
            .single();

        if (fetchError) throw fetchError;

        if (!currentProfile?.profile_photo_url) {
            return res.status(400).json({ msg: 'No profile photo to remove' });
        }

        // Update database first
        const { error: updateError } = await supabase
            .from('employees')
            .update({ profile_photo_url: null })
            .eq('id', req.user.id);

        if (updateError) throw updateError;

        // Delete photo from storage
        await imageService.deleteProfilePhoto(currentProfile.profile_photo_url);

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'PROFILE_PHOTO_REMOVED',
            metadata: { prevPhoto: currentProfile.profile_photo_url },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Profile photo removed successfully' });
    } catch (err) {
        logger.error(`Remove Photo Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PUT api/admin/profile/password
// @desc    Change password
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const isFirstLogin = req.user.is_first_login;

        // Validation
        if (!isFirstLogin && !currentPassword) {
            return res.status(400).json({ msg: 'Current password is required' });
        }
        if (!newPassword) {
            return res.status(400).json({ msg: 'New password is required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ msg: 'New password must be at least 8 characters' });
        }

        // Password strength check
        const hasUpperCase = /[A-Z]/.test(newPassword);
        const hasLowerCase = /[a-z]/.test(newPassword);
        const hasNumber = /[0-9]/.test(newPassword);

        if (!hasUpperCase || !hasLowerCase || !hasNumber) {
            return res.status(400).json({
                msg: 'Password must contain uppercase, lowercase, and number'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(newPassword, salt);

        // If NOT first login, verify current password
        if (!isFirstLogin) {
            const { data: employee, error: fetchError } = await supabase
                .from('employees')
                .select('password_hash')
                .eq('id', req.user.id)
                .single();

            if (fetchError) throw fetchError;

            const isMatch = await bcrypt.compare(currentPassword, employee.password_hash);
            if (!isMatch) {
                return res.status(400).json({ msg: 'Current password is incorrect' });
            }
        }

        // Update password and clear first login flag
        const { error: updateError } = await supabase
            .from('employees')
            .update({
                password_hash: newPasswordHash,
                is_first_login: false
            })
            .eq('id', req.user.id);

        if (updateError) throw updateError;

        // Revoke all existing sessions on password change
        await supabase
            .from('refresh_tokens')
            .update({ is_revoked: true })
            .eq('employee_id', req.user.id);

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'PASSWORD_CHANGED',
            metadata: { changedBy: 'self', isFirstLoginUpdate: !!isFirstLogin },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Password changed successfully' });
    } catch (err) {
        logger.error(`Change Password Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/admin/profile/password/request-otp
// @desc    Request OTP for password reset (verified email flow)
exports.requestPasswordResetOtp = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ msg: 'Email is required' });

        const trimmedEmail = email.trim().toLowerCase();

        // 1. Verify user exists
        const { data: user, error: userError } = await supabase
            .from('employees')
            .select('id, name, email')
            .eq('email', trimmedEmail)
            .single();

        if (userError || !user) {
            return res.status(404).json({ msg: 'User with this email not found' });
        }

        // 2. Generate secure OTP
        const otp = otpService.generateOTP(6);
        const otpHash = await bcrypt.hash(otp.toString(), 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        // 3. Invalidate any existing unverified OTPs for this email and type
        const { data: existingCols } = await supabase.from('otp_logs').select('type').limit(1);
        if (!existingCols?.error) {
            // Mark old unverified OTPs as expired (by setting is_verified to true)
            await supabase
                .from('otp_logs')
                .update({ is_verified: true })
                .eq('email', trimmedEmail)
                .eq('type', 'PASSWORD_RESET')
                .eq('is_verified', false);
        }

        // 4. Save to logs
        const insertData = {
            email: trimmedEmail,
            otp_hash: otpHash,
            expires_at: expiresAt.toISOString(),
            type: 'PASSWORD_RESET',
            attempts: 0,
            is_verified: false
        };

        const { error: logError } = await supabase
            .from('otp_logs')
            .insert(insertData);

        if (logError) {
            // FALLBACK: If 'type' column is missing, retry without it
            if (logError.message.includes('column "type" of relation "otp_logs" does not exist')) {
                const { type, ...fallbackData } = insertData;
                const { error: retryError } = await supabase
                    .from('otp_logs')
                    .insert(fallbackData);
                if (retryError) throw retryError;
            } else {
                throw logError;
            }
        }

        // 4. Send Email
        await emailService.sendOTP(trimmedEmail, user.name, otp);

        res.json({ msg: 'Verification code sent to your email' });
    } catch (err) {
        logger.error(`Request Password Reset OTP Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @route   POST api/admin/profile/password/reset-with-otp
// @desc    Reset password using OTP
exports.resetPasswordWithOtp = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        if (!email || !otp || !newPassword) {
            return res.status(400).json({ msg: 'Email, OTP, and new password are required' });
        }

        const trimmedEmail = email.trim().toLowerCase();

        // 1. Verify OTP
        let query = supabase
            .from('otp_logs')
            .select('*')
            .eq('email', trimmedEmail);

        // Try to filter by type if possible
        const { data: cols } = await supabase.from('otp_logs').select('type').limit(1);
        if (!cols?.error) {
            query = query.eq('type', 'PASSWORD_RESET');
        }

        const { data: logs, error: logError } = await query
            .order('created_at', { ascending: false })
            .limit(1);

        if (logError || !logs || logs.length === 0) {
            return res.status(400).json({ msg: 'Please request a verification code first' });
        }

        const log = logs[0];

        // Check if OTP was already used
        if (log.is_verified) {
            logger.warn(`[PASSWORD_RESET] Attempted reuse of verified OTP for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'This verification code has already been used. Please request a new one.' });
        }

        // Validate OTP format
        if (!otpService.validateOTPFormat(otp, 6)) {
            logger.warn(`[PASSWORD_RESET] Invalid OTP format for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'Invalid verification code format. Must be a 6-digit number.' });
        }

        // Check expiry
        if (otpService.isOTPExpired(log.expires_at)) {
            logger.warn(`[PASSWORD_RESET] Expired OTP attempt for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'Verification code expired. Please request a new one.' });
        }

        // Check attempts
        if (log.attempts >= 3) {
            logger.warn(`[PASSWORD_RESET] Max attempts reached for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'Too many failed attempts. Please request a new verification code.' });
        }

        const isMatch = await bcrypt.compare(otp.toString(), log.otp_hash);

        if (!isMatch) {
            // Increment attempts
            const newAttempts = (log.attempts || 0) + 1;
            await supabase
                .from('otp_logs')
                .update({ attempts: newAttempts })
                .eq('id', log.id);

            logger.warn(`[PASSWORD_RESET] Invalid OTP for ${trimmedEmail}. Attempt ${newAttempts}/3`);
            return res.status(400).json({ 
                msg: `Invalid verification code. ${3 - newAttempts} attempts remaining.` 
            });
        }

        // Mark OTP as verified (CRITICAL: Prevent reuse)
        const { data: verCheck } = await supabase.from('otp_logs').select('is_verified').limit(1);
        if (!verCheck?.error) {
            await supabase
                .from('otp_logs')
                .update({ is_verified: true, attempts: (log.attempts || 0) + 1 })
                .eq('id', log.id);
        }

        // 2. Validate New Password Strength
        if (!newPassword || typeof newPassword !== 'string') {
            return res.status(400).json({ msg: 'New password is required' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ msg: 'New password must be at least 8 characters' });
        }

        // Password strength check (same as changePassword)
        const hasUpperCase = /[A-Z]/.test(newPassword);
        const hasLowerCase = /[a-z]/.test(newPassword);
        const hasNumber = /[0-9]/.test(newPassword);

        if (!hasUpperCase || !hasLowerCase || !hasNumber) {
            return res.status(400).json({
                msg: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
            });
        }

        // 3. Hash New Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // 4. Fetch user first to ensure they exist
        const { data: user, error: userFetchError } = await supabase
            .from('employees')
            .select('id')
            .eq('email', trimmedEmail)
            .single();

        if (userFetchError || !user) {
            logger.error(`[PASSWORD_RESET] User not found: ${trimmedEmail}`);
            return res.status(404).json({ msg: 'User not found' });
        }

        // 5. Update Password
        const { error: updateError } = await supabase
            .from('employees')
            .update({
                password_hash: hashedPassword,
                is_first_login: false
            })
            .eq('email', trimmedEmail);

        if (updateError) throw updateError;

        // 6. Revoke All Tokens (Security: Force re-login)
        await supabase
            .from('refresh_tokens')
            .update({ is_revoked: true })
            .eq('employee_id', user.id);

        await auditService.logAction({
            employeeId: user?.id || null,
            action: 'PASSWORD_RESET_OTP_SUCCESS',
            metadata: { email: trimmedEmail },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Password reset successfully' });
    } catch (err) {
        logger.error(`Reset Password With OTP Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @route   GET api/admin/profile/activity
// @desc    Get recent login activity
exports.getRecentActivity = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const { data: logs, error } = await supabase
            .from('audit_logs')
            .select('action, ip_address, user_agent, created_at, metadata')
            .eq('employee_id', req.user.id)
            .in('action', ['LOGIN_SUCCESS', 'PASSWORD_CHANGED', 'PROFILE_UPDATED', 'PROFILE_PHOTO_UPDATED'])
            .order('created_at', { ascending: false })
            .limit(parseInt(limit));

        if (error) throw error;

        res.json(logs || []);
    } catch (err) {
        logger.error(`Recent Activity Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ============================================================================
// EMPLOYEE MANAGEMENT SYSTEM
// ============================================================================

// @route   GET api/admin/employees
// @desc    List all employees with filters
exports.listEmployees = async (req, res) => {
    try {
        const { department, role, search, status, workMode } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Select correct columns including employee_id
        let selectStr = 'id, employee_id, name, email, status, work_mode, profile_photo_url, created_at';

        // Try to add joins safely
        try {
            // Dynamic selects for filtering on joined tables
            const roleSelect = role ? 'roles!inner(name)' : 'roles(name)';
            const deptSelect = department ? 'departments!inner(name, code)' : 'departments(name, code)';

            let query = supabase
                .from('employees')
                .select(`${selectStr}, ${deptSelect}, ${roleSelect}`, { count: 'exact' });

            if (status) query = query.eq('status', status.toUpperCase());
            if (workMode) query = query.eq('work_mode', workMode);
            if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

            // Apply relation filters
            if (role) query = query.ilike('roles.name', `%${role}%`);
            if (department) {
                const deptCodes = department.split(',').map(d => d.trim().toUpperCase());
                if (deptCodes.length > 1) {
                    query = query.in('departments.code', deptCodes);
                } else {
                    query = query.eq('departments.code', deptCodes[0]);
                }
            }

            const { data, error, count } = await query
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) throw error;

            const formatted = (data || []).map(emp => ({
                id: emp.id,
                employee_id: emp.employee_id || 'N/A',
                name: emp.name,
                email: emp.email,
                status: emp.status,
                workMode: emp.work_mode,
                profilePhoto: getFullImageUrl(req, emp.profile_photo_url),
                department: (Array.isArray(emp.departments) ? emp.departments[0] : emp.departments)?.name || 'N/A',
                createdAt: emp.created_at
            }));

            return res.json({
                employees: formatted,
                total: count || formatted.length,
                page: parseInt(page),
                limit: parseInt(limit),
                _debug_source: 'ULTRA_DEFENSIVE_V3'
            });
        } catch (innerErr) {
            logger.error(`Inner Query Failed: ${innerErr.message}`);
            // If main query fails, propagate error instead of returning unpaginated fallback
            throw innerErr;
        }
    } catch (err) {
        logger.error(`CRITICAL List Employees Error: ${err.message}`);
        res.status(500).json({ msg: 'Database Error', error: err.message });
    }
};

// @route   GET api/admin/teammates
// @desc    List teammates (Employees in the same department)
exports.listTeammates = async (req, res) => {
    try {
        const { search, status, workMode } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // 1. Get the current user's department info
        // We fetch from DB to be absolutely sure we have the right ID
        const { data: currentUser, error: userError } = await supabase
            .from('employees')
            .select('department_id')
            .eq('id', req.user.id)
            .single();

        if (userError || !currentUser?.department_id) {
            logger.error(`List Teammates - User Fetch Error: ${userError?.message}`);
            return res.status(403).json({ msg: 'Unauthorized: Department not found' });
        }

        const deptId = currentUser.department_id;

        // 2. Build Query
        let selectStr = 'id, employee_id, name, email, status, work_mode, profile_photo_url, created_at';
        let query = supabase
            .from('employees')
            .select(`${selectStr}, departments(name, code), roles(name)`, { count: 'exact' })
            .eq('department_id', deptId);

        // Apply filters
        if (status) query = query.eq('status', status.toUpperCase());
        if (workMode) query = query.eq('work_mode', workMode);
        if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            logger.error(`List Teammates Query Error: ${error.message}`);
            throw error;
        }

        // 3. Format Response
        const formatted = (data || []).map(emp => ({
            id: emp.id,
            employee_id: emp.employee_id || 'N/A',
            name: emp.name,
            email: emp.email,
            status: emp.status,
            workMode: emp.work_mode,
            profilePhoto: getFullImageUrl(req, emp.profile_photo_url),
            department: (Array.isArray(emp.departments) ? emp.departments[0] : emp.departments)?.name || 'N/A',
            role: (Array.isArray(emp.roles) ? emp.roles[0] : emp.roles)?.name || 'Employee',
            createdAt: emp.created_at
        }));

        res.json({
            employees: formatted,
            total: count || formatted.length,
            page: parseInt(page),
            limit: parseInt(limit)
        });

    } catch (err) {
        logger.error(`List Teammates Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   POST api/admin/employees/request-otp
// @desc    Request OTP for creating new employee (Verified Email)
exports.requestEmployeeCreationOtp = async (req, res) => {
    try {
        const { email, candidateName } = req.body;

        if (!email) return res.status(400).json({ msg: 'Email is required' });
        const trimmedEmail = email.trim().toLowerCase();

        if (!validationService.validateEmail(trimmedEmail)) {
            return res.status(400).json({ msg: 'Please provide a valid email address with @ and domain' });
        }

        // 0. Domain Validation (Strict Company Policy)
        if (!validationService.validateCompanyEmail(trimmedEmail)) {
            return res.status(400).json({ msg: 'Registration is restricted to official company emails only (@jvoversea.com)' });
        }

        // 1. Generate secure OTP
        const otp = otpService.generateOTP(6);
        const otpHash = await bcrypt.hash(otp.toString(), 10);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        // 2. Invalidate any existing unverified OTPs for this email and type
        const { data: existingCols } = await supabase.from('otp_logs').select('type').limit(1);
        if (!existingCols?.error) {
            // Mark old unverified OTPs as expired (by setting is_verified to true)
            await supabase
                .from('otp_logs')
                .update({ is_verified: true })
                .eq('email', trimmedEmail)
                .eq('type', 'EMPLOYEE_CREATION')
                .eq('is_verified', false);
        }

        // 3. Database Record
        const insertData = {
            email: trimmedEmail,
            otp_hash: otpHash,
            expires_at: expiresAt.toISOString(),
            type: 'EMPLOYEE_CREATION',
            attempts: 0,
            is_verified: false
        };

        const { error: dbError } = await supabase
            .from('otp_logs')
            .insert(insertData);

        if (dbError) {
            // FALLBACK: If 'type' column is missing, retry without it
            if (dbError.message.includes('column "type" of relation "otp_logs" does not exist')) {
                const { type, ...fallbackData } = insertData;
                const { error: retryError } = await supabase
                    .from('otp_logs')
                    .insert(fallbackData);
                if (retryError) throw retryError;
            } else {
                throw dbError;
            }
        }

        // 3. Dispatch Email
        await emailService.sendEmployeeCreationOTP(trimmedEmail, candidateName || 'Candidate', otp);

        logger.info(`[OTP] Sent to ${trimmedEmail} (Creation)`);
        res.json({ msg: `Verification code sent to ${trimmedEmail}` });

    } catch (err) {
        logger.error(`Request OTP Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to send verification code' });
    }
};

// @route   POST api/admin/employees
// @desc    Create a new employee
exports.createEmployee = async (req, res) => {
    try {
        let { name, email, phone, departmentCode, status, workMode, otp, notes, department, work_mode, accountType } = req.body;

        // Handle alternate frontend keys
        departmentCode = departmentCode || department;
        workMode = workMode || work_mode;

        const isAdmin = accountType === 'admin';

        if (!email) return res.status(400).json({ msg: 'Email is required' });
        const trimmedEmail = email.trim().toLowerCase();

        if (!validationService.validateEmail(trimmedEmail)) {
            return res.status(400).json({ msg: 'Please provide a valid email address' });
        }

        // 0. Domain Validation (Strict Company Policy)
        if (!validationService.validateCompanyEmail(trimmedEmail)) {
            return res.status(400).json({ msg: 'Registration is restricted to official company emails only (@jvoversea.com)' });
        }

        if (phone && !validationService.validatePhone(phone)) {
            return res.status(400).json({ msg: 'Phone number must be exactly 10 digits' });
        }

        // 1. Verification Check (OTP)
        if (!otp) {
            return res.status(400).json({ msg: 'Email verification code is required' });
        }

        // Verify OTP from logs
        let query = supabase
            .from('otp_logs')
            .select('*')
            .eq('email', trimmedEmail);

        // Try to filter by type if possible
        const { data: cols } = await supabase.from('otp_logs').select('type').limit(1);
        if (!cols?.error) {
            query = query.eq('type', 'EMPLOYEE_CREATION');
        }

        const { data: logs, error: logError } = await query
            .order('created_at', { ascending: false })
            .limit(1);

        if (logError || !logs || logs.length === 0) {
            return res.status(400).json({ msg: 'Please verify your email first' });
        }

        const log = logs[0];

        // Check if OTP was already used
        if (log.is_verified) {
            logger.warn(`[EMPLOYEE_CREATE] Attempted reuse of verified OTP for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'This verification code has already been used. Please request a new one.' });
        }

        // Validate OTP format
        if (!otpService.validateOTPFormat(otp, 6)) {
            logger.warn(`[EMPLOYEE_CREATE] Invalid OTP format for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'Invalid verification code format. Must be a 6-digit number.' });
        }

        // Check expiry
        if (otpService.isOTPExpired(log.expires_at)) {
            logger.warn(`[EMPLOYEE_CREATE] Expired OTP attempt for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'Verification code expired. Please request a new one.' });
        }

        // Check attempts
        if (log.attempts >= 3) {
            logger.warn(`[EMPLOYEE_CREATE] Max attempts reached for ${trimmedEmail}`);
            return res.status(400).json({ msg: 'Too many failed attempts. Please request a new verification code.' });
        }

        const isMatch = await bcrypt.compare(otp.toString(), log.otp_hash);

        if (!isMatch) {
            // Increment attempts
            const newAttempts = (log.attempts || 0) + 1;
            await supabase
                .from('otp_logs')
                .update({ attempts: newAttempts })
                .eq('id', log.id);

            logger.warn(`[EMPLOYEE_CREATE] Invalid OTP for ${trimmedEmail}. Attempt ${newAttempts}/3`);
            return res.status(400).json({ 
                msg: `Invalid verification code. ${3 - newAttempts} attempts remaining.` 
            });
        }

        // Mark OTP as verified (CRITICAL: Prevent reuse)
        const { data: verCheck } = await supabase.from('otp_logs').select('is_verified').limit(1);
        if (!verCheck?.error) {
            await supabase
                .from('otp_logs')
                .update({ is_verified: true, attempts: (log.attempts || 0) + 1 })
                .eq('id', log.id);
        }

        // 2. Strict Department Validation
        const allowedDepts = ['counsellor', 'admission', 'wfh', 'field', 'super_admin'];
        if (!allowedDepts.includes(departmentCode)) {
            logger.warn(`[EMPLOYEE_CREATE] 400 Failure for ${trimmedEmail}: Invalid department '${departmentCode}'`);
            return res.status(400).json({ msg: 'Invalid department code provided' });
        }

        // 3. Phone Number Validation
        if (!validationService.validatePhone(phone)) {
            logger.warn(`[EMPLOYEE_CREATE] 400 Failure for ${trimmedEmail}: Invalid phone '${phone}'`);
            return res.status(400).json({ msg: 'Invalid mobile number. Please enter a valid 10-digit number.' });
        }

        // 2. Strict Email Uniqueness Check
        const normalizedEmail = validationService.normalizeEmail(email);
        const alreadyRegistered = await validationService.isEmailRegistered(normalizedEmail, req);

        if (alreadyRegistered) {
            await auditService.logAction({
                employeeId: req.user.id,
                action: 'EMPLOYEE_CREATION_FAILED',
                metadata: { email: normalizedEmail, reason: 'EMAIL_ALREADY_REGISTERED' },
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            return res.status(400).json({
                error: 'EMAIL_ALREADY_REGISTERED',
                message: 'This email ID is already registered. Please use a different email or contact support.'
            });
        }

        // 3. Get Dept ID and Role ID
        // Map frontend codes to DB codes
        const deptCodeMap = {
            'counsellor': 'COUN',
            'admission': 'ADMN',
            'wfh': 'WFH',
            'field': 'FIELD',
            'super_admin': 'ADMIN'
        };
        const dbDeptCode = deptCodeMap[departmentCode] || departmentCode.toUpperCase();

        const { data: dept } = await supabase.from('departments').select('id').eq('code', dbDeptCode).single();

        if (!dept) {
            logger.warn(`Department not found for code: ${dbDeptCode} (orig: ${departmentCode})`);
            return res.status(400).json({ msg: `Department not found: ${dbDeptCode}. Please contact system admin.` });
        }



        // 3a. If creating Admin, enforce limits (Max 2 for Depts, Unlimited for Super Admin)
        if (isAdmin && dbDeptCode !== 'ADMIN') {
            const { count, error: countError } = await supabase
                .from('employees')
                .select('*', { count: 'exact', head: true })
                .eq('department_id', dept.id)
                .eq('is_admin', true)
                .eq('status', 'ACTIVE');

            if (count >= 2) {
                return res.status(400).json({
                    msg: `Maximum active admin limit (2) reached for ${dbDeptCode}. Please deactivate an existing admin first.`
                });
            }
        }

        // Map department code to role name based on account type
        // Role names must match exactly with roles table in database
        const roleMap = {
            'counsellor': isAdmin ? 'Counselling Admin' : 'Counsellor',
            'admission': isAdmin ? 'Admission Admin' : 'Admission Officer',
            'wfh': isAdmin ? 'WFH Admin' : 'WFH Associate',
            'field': 'Field Agent', // No admin variant
            'super_admin': 'Super Administrator'
        };
        // Fallback or use provided code if mapped
        const roleName = roleMap[departmentCode] || 'Guest';

        let { data: role } = await supabase.from('roles').select('id').eq('name', roleName).single();

        if (!role) {
            logger.warn(`Role not found for name: ${roleName}`);
            // Retry with "Super Admin" if "Super Administrator" failed
            if (roleName === 'Super Administrator') {
                const { data: retryRole } = await supabase.from('roles').select('id').eq('name', 'Super Admin').single();
                if (!retryRole) return res.status(400).json({ msg: `Role not found: ${roleName}` });
                role = retryRole;
            } else {
                return res.status(400).json({ msg: `Role not found: ${roleName}. Please check roles table.` });
            }
        }

        // VALIDATION: Ensure role assignment matches admin status to prevent future bugs
        const roleNameLower = roleName.toLowerCase();
        const hasAdminInRoleName = roleNameLower.includes('admin');
        if (isAdmin && !hasAdminInRoleName) {
            logger.error(`Role mismatch detected: Creating admin user but role is '${roleName}' (should contain 'Admin')`);
            return res.status(500).json({
                msg: 'Internal error: Role assignment mismatch. Please contact support.',
                debug: `Expected admin role but got: ${roleName}`
            });
        }
        if (!isAdmin && hasAdminInRoleName && departmentCode !== 'super_admin') {
            logger.error(`Role mismatch detected: Creating regular user but role is '${roleName}' (contains 'Admin')`);
            return res.status(500).json({
                msg: 'Internal error: Role assignment mismatch. Please contact support.',
                debug: `Expected regular role but got: ${roleName}`
            });
        }

        logger.info(`Creating ${isAdmin ? 'ADMIN' : 'EMPLOYEE'} with role: ${roleName} for department: ${dbDeptCode}`);

        // 4. Generate metadata
        const employeeId = generateEmployeeId();

        // Auto-generate default password: firstname@jvoverseas
        const firstName = name.split(' ')[0].toLowerCase().trim();
        const defaultPassword = `${firstName}@jvoverseas`;

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(defaultPassword, salt);

        // 5. Create Employee Storage First (to ensure file system is ready)
        await imageService.createEmployeeStorage(employeeId);

        // 6. Create Employee in DB
        const insertData = {
            employee_id: employeeId,
            name,
            email: normalizedEmail,
            phone,
            password_hash: hashedPassword,
            department_id: dept.id,
            role_id: role?.id,
            status: status || 'ACTIVE',
            work_mode: workMode || 'Office',
            notes: notes,
            status: status || 'ACTIVE',
            work_mode: workMode || 'Office',
            notes: notes,
            is_first_login: true, // Force password change on first login
            is_admin: isAdmin     // Set Admin Flag
        };

        const { data: newEmployee, error: createError } = await supabase
            .from('employees')
            .insert(insertData)
            .select()
            .single();

        if (createError) {
            if (createError.message.includes('column') && createError.message.includes('not exist')) {
                return res.status(400).json({
                    msg: 'Database schema is out of date. Please run the SQL migration script from the implementation plan.',
                    missing_column: createError.message
                });
            }
            throw createError;
        }

        // 6. Log Audit
        // 7. Send Welcome Email
        try {
            await emailService.sendEmployeeWelcomeEmail(normalizedEmail, name, defaultPassword);
        } catch (emailErr) {
            logger.error(`Failed to send welcome email to ${normalizedEmail}: ${emailErr.message}`);
        }

        // 8. Log Audit
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'EMPLOYEE_CREATED',
            metadata: {
                newEmployeeId: newEmployee.id,
                newEmployeeEmail: normalizedEmail,
                assignedDept: dbDeptCode
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        // 9. Success
        res.status(201).json({
            msg: 'Employee created successfully',
            employee: {
                id: newEmployee.id,
                employee_id: newEmployee.employee_id || employeeId,
                tempPassword: defaultPassword // Show once to admin
            }
        });

    } catch (err) {
        logger.error(`Create Employee Error: ${err.message}`);
        res.status(500).json({ msg: err.message || 'Server Error' });
    }
};

// @route   GET api/admin/employees/:id
// @desc    Get detailed employee profile (ADMIN ONLY)
exports.getEmployeeDetail = async (req, res) => {
    try {
        const { id } = req.params;

        // Start with basic columns we KNOW exist
        let selectStr = `
            id, employee_id, name, email, phone, status, work_mode, profile_photo_url, 
            created_at, updated_at, department_id, role_id,
            last_login, ip_fingerprint, department_head,
            departments(name, code),
            roles(name)
        `;

        const { data: employee, error } = await supabase
            .from('employees')
            .select(selectStr)
            .eq('id', id)
            .single();

        if (error || !employee) {
            logger.error(`Get Employee Detail Error: ${error?.message || 'Not found'}`);
            return res.status(404).json({ msg: 'Employee not found' });
        }

        // 1. Log Audit Action: Employee Profile Viewed
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'EMPLOYEE_PROFILE_VIEWED',
            metadata: {
                targetEmployeeId: id,
                targetName: employee.name,
                targetEmployeeCode: employee.employee_id
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        // 2. Get activity logs
        const { data: activity } = await supabase
            .from('audit_logs')
            .select('*')
            .eq('employee_id', id)
            .order('created_at', { ascending: false })
            .limit(20);

        // 3. Construct response
        res.json({
            ...employee,
            profilePhoto: getFullImageUrl(req, employee.profile_photo_url),
            department: employee.departments?.name,
            role: employee.roles?.name,
            reportingManagerName: 'Not Assigned',
            statusChangedByName: 'System',
            activity_logs: activity || []
        });
    } catch (err) {
        logger.error(`Get Employee Detail Critical Error: ${err.message}`);
        res.status(500).json({ msg: 'Internal Server Error' });
    }
};

// @route   PUT api/admin/employees/:id
// @desc    Update employee (Restricted)
exports.updateEmployee = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, phone, status, work_mode, department, role,
            location_branch, location_city, location_state,
            shift_timing, department_head, employment_type, work_schedule,
            access_level, data_access, notes
        } = req.body;

        // 1. Build Update Object (Restrict Email & EmployeeID)
        const updateData = {};
        if (name) updateData.name = name;
        if (phone) {
            if (!validationService.validatePhone(phone)) {
                return res.status(400).json({ msg: 'Phone number must be exactly 10 digits' });
            }
            updateData.phone = phone;
        }
        if (status) updateData.status = status;
        if (work_mode) updateData.work_mode = work_mode;
        if (location_branch) updateData.location_branch = location_branch;
        if (location_city) updateData.location_city = location_city;
        if (location_state) updateData.location_state = location_state;
        if (shift_timing) updateData.shift_timing = shift_timing;
        if (department_head) updateData.department_head = department_head;
        if (employment_type) updateData.employment_type = employment_type;
        if (work_schedule) updateData.work_schedule = work_schedule;
        if (access_level) updateData.access_level = access_level;
        if (data_access) updateData.data_access = data_access;
        if (notes) updateData.notes = notes;

        // 2. Handle Department/Role Update
        if (department) {
            const { data: dept } = await supabase.from('departments').select('id').eq('code', department).single();
            if (dept) {
                updateData.department_id = dept.id;

                // Also update role if it's tied to department or explicitly passed
                const targetRole = role || department;
                const roleMap = {
                    'counsellor': 'Counsellor',
                    'admission': 'Admission',
                    'wfh': 'WFH',
                    'field': 'Field Agent',
                    'super_admin': 'Super Admin'
                };
                const roleName = roleMap[targetRole.toLowerCase()] || targetRole;
                const { data: roleData } = await supabase.from('roles').select('id').eq('name', roleName).single();
                if (roleData) updateData.role_id = roleData.id;
            }
        }

        const { data: updated, error } = await supabase
            .from('employees')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            if (error.message.includes('column') && error.message.includes('not exist')) {
                return res.status(400).json({
                    msg: 'Schema mismatch. Ensure work_mode exists.',
                    missing_column: error.message
                });
            }
            throw error;
        }

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'EMPLOYEE_UPDATED',
            metadata: { targetEmployee: id, updates: Object.keys(updateData) },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Employee updated successfully', employee: updated });
    } catch (err) {
        logger.error(`Update Employee Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', error: err.message });
    }
};

// @route   DELETE api/admin/employees/:id
// @desc    Soft delete (Deactivate)
exports.deleteEmployee = async (req, res) => {
    try {
        const { id } = req.params;

        // SOFT DELETE: Change status to INACTIVE
        const { error } = await supabase
            .from('employees')
            .update({ status: 'INACTIVE' })
            .eq('id', id);

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'EMPLOYEE_DELETED',
            metadata: { targetEmployee: id, method: 'SOFT_DELETE' },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Employee deactivated successfully (Soft Deleted)' });
    } catch (err) {
        logger.error(`Soft Delete Error: ${err.message}`);
        res.status(500).json({ msg: 'Internal Server Error' });
    }
};

// @route   DELETE api/admin/registrations/:id/test
// @desc    Hard delete test registration (Super Admin Only)
exports.deleteTestRegistration = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch info and check if it's test data
        // Explicitly fetch is_test_data which might be null or missing
        const { data: reg, error: fetchError } = await supabase
            .from('registrations')
            .select('id, name, email, is_test_data')
            .eq('id', id)
            .single();

        if (fetchError || !reg) {
            return res.status(404).json({ msg: 'Registration not found' });
        }

        // Logic check: Must be Super Admin AND record must be test data
        // req.user.role is normalized by auth middleware, but we rely on isAdmin middleware for primary protection
        if (!reg.is_test_data) {
            return res.status(403).json({
                msg: 'Action Denied: This is a live student record. Only test data can be deleted from the database.'
            });
        }

        // 2. Hard Delete (Atomic)
        const { error } = await supabase
            .from('registrations')
            .delete()
            .eq('id', id);

        if (error) throw error;

        // 3. Log Audit
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'TEST_RECORD_DELETED',
            metadata: {
                targetId: id,
                targetName: reg.name,
                targetEmail: reg.email,
                is_test_data: true
            },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: 'Test record permanently deleted from CRM.' });
    } catch (err) {
        logger.error(`Delete Test Registration Error: ${err.message}`);
        res.status(500).json({ msg: 'Internal Server Error', error: err.message });
    }
};

// @route   PATCH api/admin/employees/:id/status
// @desc    Toggle employee status (ACTIVE/INACTIVE)
exports.toggleEmployeeStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['ACTIVE', 'INACTIVE', 'ON LEAVE', 'LEFT_JOB', 'SUSPENDED'].includes(status)) {
            return res.status(400).json({ msg: 'Invalid status' });
        }

        const updateData = {
            status,
            last_status_change_at: new Date().toISOString(),
            last_status_change_by: req.user.id
        };

        const { data: updated, error } = await supabase
            .from('employees')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'EMPLOYEE_STATUS_CHANGED',
            metadata: { targetEmployee: id, newStatus: status },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({ msg: `Employee status updated to ${status}`, employee: updated });
    } catch (err) {
        logger.error(`Toggle Status Error: ${err.message}`);
        res.status(500).json({ msg: 'Internal Server Error', error: err.message });
    }
};

// @route   POST api/admin/employees/:id/reset-password
// @desc    Generate a temporary password and return it
exports.resetEmployeePassword = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Generate temp password
        const tempPassword = Math.random().toString(36).slice(-12) + '@Res';
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(tempPassword, salt);

        // 2. Update in DB
        const { error } = await supabase
            .from('employees')
            .update({ password_hash: hashedPassword })
            .eq('id', id);

        if (error) throw error;

        // 3. Log Audit
        await auditService.logAction({
            employeeId: req.user.id,
            action: 'EMPLOYEE_PASSWORD_RESET',
            metadata: { targetEmployee: id },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        res.json({
            msg: 'Password reset successful',
            tempPassword // In production this goes to email
        });
    } catch (err) {
        logger.error(`Reset Password Error: ${err.message}`);
        res.status(500).json({ msg: 'Internal Server Error', error: err.message });
    }
};

// @route   GET api/admin/department-admins
// @desc    Get active admins for creating employees context
exports.getDepartmentAdmins = async (req, res) => {
    try {
        // We need 1 active admin for: COUN, ADMN, WFH
        const targetCodes = ['COUN', 'ADMN', 'WFH'];

        const { data: employees, error } = await supabase
            .from('employees')
            .select(`
                name, 
                email, 
                departments!inner(code)
            `)
            .eq('status', 'ACTIVE')
            .eq('is_admin', true)
            .in('departments.code', targetCodes);

        if (error) throw error;

        // Process to get map
        const adminMap = {};

        // Initialize default
        targetCodes.forEach(code => {
            adminMap[code] = { name: 'Not Assigned', email: '' };
        });

        employees.forEach(emp => {
            const code = emp.departments.code;
            // Overwrite if found (assuming single admin, or take last/first)
            adminMap[code] = {
                name: emp.name,
                email: emp.email
            };
        });

        res.json(adminMap);
    } catch (err) {
        logger.error(`Get Dept Admins Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// @route   GET api/admin/departments
// @desc    Get all active departments
exports.getDepartments = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('departments')
            .select('id, name, code')
            .order('name');

        if (error) throw error;
        res.json(data);
    } catch (err) {
        logger.error(`Get Departments Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

