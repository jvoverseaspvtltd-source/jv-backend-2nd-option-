const supabase = require('../config/supabaseClient');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const logger = require('../utils/logger');
const otpService = require('../services/otp.service');
const emailService = require('../services/email.service');
const { generateSignedUrl } = require('../middleware/storage.middleware');
const { getCookieSecurityOptions } = require('../utils/cookieOptions');

// @route   POST api/student/request-reset
// @desc    Request Password Reset OTP
exports.requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;

        const { data: student, error } = await supabase
            .from('registrations')
            .select('id, name, email, workflow')
            .eq('email', email)
            .single();

        if (error || !student) {
            return res.status(404).json({ msg: 'Email not found.' });
        }

        const otp = otpService.generateOTP();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins

        // Update workflow with OTP
        const updatedWorkflow = {
            ...student.workflow,
            resetOTP: otp,
            resetOTPExpiry: otpExpiry
        };

        const { error: updateError } = await supabase
            .from('registrations')
            .update({ workflow: updatedWorkflow })
            .eq('id', student.id);

        if (updateError) throw updateError;

        await emailService.sendOTP(student.email, student.name, otp);

        res.json({ msg: 'OTP sent to your email.' });

    } catch (err) {
        logger.error(`Reset Request Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/student/reset-password
// @desc    Reset Password with OTP
exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        const { data: student, error } = await supabase
            .from('registrations')
            .select('id, workflow')
            .eq('email', email)
            .single();

        if (error || !student) {
            return res.status(404).json({ msg: 'Student not found.' });
        }

        const { resetOTP, resetOTPExpiry } = student.workflow || {};

        if (!resetOTP || resetOTP !== otp) {
            return res.status(400).json({ msg: 'Invalid OTP.' });
        }

        if (new Date() > new Date(resetOTPExpiry)) {
            return res.status(400).json({ msg: 'OTP has expired.' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);

        const updatedWorkflow = {
            ...student.workflow,
            passwordHash,
            resetOTP: null,
            resetOTPExpiry: null
        };

        const { error: updateError } = await supabase
            .from('registrations')
            .update({ workflow: updatedWorkflow })
            .eq('id', student.id);

        if (updateError) throw updateError;

        // Revoke all sessions on password reset
        await supabase
            .from('refresh_tokens')
            .update({ is_revoked: true })
            .eq('employee_id', student.id);

        res.json({ msg: 'Password reset successfully. Please login with new password.' });

    } catch (err) {
        logger.error(`Reset Password Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   PUT api/student/profile
// @desc    Update Student Profile (Partial)
exports.updateProfile = async (req, res) => {
    try {
        const { name, dob, profilePicture, phone } = req.body;

        const { data: student, error: fetchError } = await supabase
            .from('registrations')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (fetchError) throw fetchError;

        const updatedWorkflow = {
            ...student.workflow,
            dob: dob,
            profilePicture: profilePicture
        };

        const updates = {
            name: name,
            phone: phone,
            workflow: updatedWorkflow
        };

        const { error } = await supabase
            .from('registrations')
            .update(updates)
            .eq('id', req.user.id);

        if (error) throw error;

        res.json({ msg: 'Profile updated successfully', updates });

    } catch (err) {
        logger.error(`Update Profile Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/student/login
// @desc    Student Login
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const { data: student, error } = await supabase
            .from('registrations')
            .select('id, name, email, student_id, workflow, status')
            .ilike('email', email) // Case-insensitive email lookup
            .single();

        if (error || !student) {
            logger.warn(`Student Login Failed: Email ${email} not found.`);
            return res.status(404).json({ msg: 'Invalid credentials' });
        }

        const storedPasswordHash = student.workflow?.passwordHash;

        if (!storedPasswordHash) {
            logger.warn(`Student Login Failed: Email ${email} has no password hash.`);
            return res.status(403).json({ msg: 'Account not set up. Please contact support.' });
        }

        const isMatch = await bcrypt.compare(password, storedPasswordHash);
        if (!isMatch) {
            logger.warn(`Student Login Failed: Email ${email} invalid password.`);
            return res.status(401).json({ msg: 'Invalid credentials' });
        }

        // Return JWTs
        const payload = {
            user: {
                id: student.id,
                email: student.email,
                role: 'student'
            }
        };

        const accessToken = jwt.sign(payload, config.jwtSecret, { expiresIn: '60m' });
        const refreshToken = jwt.sign({ id: student.id, type: 'student' }, config.jwtSecret, { expiresIn: '7d' });
        const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

        // Session Management: Enforce max 2 devices for students
        const { data: existingSessions } = await supabase
            .from('refresh_tokens')
            .select('id')
            .eq('employee_id', student.id)
            .eq('is_revoked', false)
            .order('created_at', { ascending: true });

        if (existingSessions && existingSessions.length >= 2) {
            await supabase
                .from('refresh_tokens')
                .update({ is_revoked: true })
                .eq('id', existingSessions[0].id);
        }

        // Store Refresh Token
        await supabase
            .from('refresh_tokens')
            .insert({
                employee_id: student.id,
                token_hash: refreshTokenHash,
                ip_address: req.ip,
                user_agent: req.headers['user-agent'],
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });

        // Set Cookie
        const { secure, sameSite } = getCookieSecurityOptions(req);

        res.cookie('studentRefreshToken', refreshToken, {
            httpOnly: true,
            secure,
            sameSite,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({
            token: accessToken,
            user: {
                id: student.id,
                name: student.name,
                email: student.email,
                studentId: student.student_id
            }
        });

    } catch (err) {
        logger.error(`Student Login Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/student/me
// @desc    Get current student dashboard data
exports.getDashboard = async (req, res) => {
    try {
        const { data: student, error } = await supabase
            .from('registrations')
            .select('*')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        const dashboardData = {
            id: student.id,
            studentId: student.student_id,
            name: student.name,
            email: student.email,
            status: student.status,
            course: student.course,
            preferredCountry: student.workflow?.preferredCountry || student.course,
            loanOpted: student.workflow?.loanOpted,
            workflow: student.workflow,
            paymentDetails: student.payment_details,
            activities: student.activities,
            phone: student.phone || student.mobile,
            created_at: student.created_at
        };

        res.json(dashboardData);

    } catch (err) {
        logger.error(`Student Dashboard Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/student/my-applications
// @desc    Get current student's university applications
exports.getMyApplications = async (req, res) => {
    try {
        const { data: applications, error } = await supabase
            .from('admission_applications')
            .select('*')
            .eq('registration_id', req.user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Generate signed URLs for offer letters if they exist
        const applicationsWithUrls = await Promise.all(applications.map(async (app) => {
            if (app.offer_letter_url) {
                try {
                    const signedUrl = await generateSignedUrl(app.offer_letter_url, 'study-materials');
                    return { ...app, offer_letter_url: signedUrl };
                } catch (urlErr) {
                    logger.error(`Error generating signed URL for application ${app.id}: ${urlErr.message}`);
                    return app;
                }
            }
            return app;
        }));

        res.json(applicationsWithUrls);
    } catch (err) {
        logger.error(`getMyApplications Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

/**
 * REFRESH TOKEN (STUDENT)
 */
exports.refreshToken = async (req, res) => {
    const oldRefreshToken = req.cookies?.studentRefreshToken;

    if (!oldRefreshToken) {
        return res.status(401).json({ msg: 'No refresh token provided' });
    }

    try {
        const decoded = jwt.verify(oldRefreshToken, config.jwtSecret);

        // Fetch Student
        const { data: student, error } = await supabase
            .from('registrations')
            .select('id, name, email, student_id')
            .eq('id', decoded.id)
            .single();

        if (error || !student) {
            return res.status(401).json({ msg: 'Invalid session' });
        }

        // Verify Hash in DB
        const { data: session } = await supabase
            .from('refresh_tokens')
            .select('*')
            .eq('employee_id', student.id)
            .eq('is_revoked', false);

        let matchingSession = null;
        if (session) {
            for (const s of session) {
                const isMatch = await bcrypt.compare(oldRefreshToken, s.token_hash);
                if (isMatch) {
                    matchingSession = s;
                    break;
                }
            }
        }

        if (!matchingSession) {
            // Reuse detected -> Revoke everything for this student
            await supabase
                .from('refresh_tokens')
                .update({ is_revoked: true })
                .eq('employee_id', student.id);
            return res.status(401).json({ msg: 'Security alert: Refresh token already used.' });
        }

        // Rotate
        await supabase
            .from('refresh_tokens')
            .update({ is_revoked: true })
            .eq('id', matchingSession.id);

        const accessToken = jwt.sign(
            { user: { id: student.id, email: student.email, role: 'student' } },
            config.jwtSecret,
            { expiresIn: '60m' }
        );
        const newRefreshToken = jwt.sign(
            { id: student.id, type: 'student' },
            config.jwtSecret,
            { expiresIn: '7d' }
        );
        const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);

        await supabase
            .from('refresh_tokens')
            .insert({
                employee_id: student.id,
                token_hash: newRefreshTokenHash,
                ip_address: req.ip,
                user_agent: req.headers['user-agent'],
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });

        const { secure, sameSite } = getCookieSecurityOptions(req);

        res.cookie('studentRefreshToken', newRefreshToken, {
            httpOnly: true,
            secure,
            sameSite,
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ token: accessToken });

    } catch (err) {
        res.status(401).json({ msg: 'Session expired' });
    }
};

/**
 * LOGOUT (STUDENT)
 */
exports.logout = async (req, res) => {
    try {
        if (req.user) {
            await supabase
                .from('refresh_tokens')
                .update({ is_revoked: true })
                .eq('employee_id', req.user.id);
        }
        res.clearCookie('studentRefreshToken');
        res.json({ msg: 'Logged out successfully' });
    } catch (err) {
        res.status(500).json({ msg: 'Logout failed' });
    }
};
