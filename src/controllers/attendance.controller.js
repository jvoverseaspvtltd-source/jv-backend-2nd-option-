const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');

// @route   POST /api/attendance/clock-in
// @desc    Record employee clock-in
exports.clockIn = async (req, res) => {
    try {
        // 1. Determine target employee (Force self for standard roles)
        const role = req.user.role;
        const targetEmployeeId = ['super_admin', 'counselling_admin', 'admission_admin', 'wfh_admin'].includes(role)
            ? (req.body.employeeId || req.user.id)
            : req.user.id;

        const today = new Date().toISOString().split('T')[0];

        // 2. Check if already clocked in today
        const { data: existing } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('employee_id', targetEmployeeId)
            .eq('date', today)
            .single();

        if (existing && existing.login_time) {
            return res.status(400).json({ msg: 'Already clocked in today' });
        }

        // 3. Fetch employee data for snapshots
        const { data: employee, error: employeeError } = await supabase
            .from('employees')
            .select('department_id, roles(name)')
            .eq('id', targetEmployeeId)
            .single();

        if (employeeError || !employee) {
            logger.error(`Snapshot fetch error for ${targetEmployeeId}: ${employeeError?.message}`);
            throw new Error('Employee not found or role/dept missing');
        }

        const loginTime = new Date().toISOString();
        const snapshots = {
            role_snapshot: employee.roles?.name || 'Unknown',
            dept_snapshot: employee.department_id
        };

        let result;
        if (existing) {
            // Update existing record
            result = await supabase
                .from('attendance_logs')
                .update({
                    login_time: loginTime,
                    ...snapshots
                })
                .eq('id', existing.id);

            // FALLBACK: If columns don't exist (Error 42703 is undefined column)
            if (result.error && (result.error.code === '42703' || result.error.message.includes('column'))) {
                logger.warn('[SCHEMA_FALLBACK] Missing snapshot columns in attendance_logs. Retrying basic update.');
                result = await supabase
                    .from('attendance_logs')
                    .update({ login_time: loginTime })
                    .eq('id', existing.id);
            }
        } else {
            // Create new record
            result = await supabase
                .from('attendance_logs')
                .insert({
                    employee_id: targetEmployeeId,
                    date: today,
                    login_time: loginTime,
                    ...snapshots
                });

            // FALLBACK: If columns don't exist
            if (result.error && (result.error.code === '42703' || result.error.message.includes('column'))) {
                logger.warn('[SCHEMA_FALLBACK] Missing snapshot columns in attendance_logs. Retrying basic insert.');
                result = await supabase
                    .from('attendance_logs')
                    .insert({
                        employee_id: targetEmployeeId,
                        date: today,
                        login_time: loginTime
                    });
            }
        }

        if (result.error) throw result.error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'CLOCK_IN',
            metadata: { target: targetEmployeeId, date: today, time: loginTime },
            ip: req.ip
        });

        res.json({ msg: 'Clocked in successfully', login_time: loginTime });
    } catch (err) {
        logger.error(`Clock-in error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   POST /api/attendance/clock-out
// @desc    Record employee clock-out
exports.clockOut = async (req, res) => {
    try {
        // 1. Determine target employee
        const role = req.user.role;
        const targetEmployeeId = ['super_admin', 'counselling_admin', 'admission_admin', 'wfh_admin'].includes(role)
            ? (req.body.employeeId || req.user.id)
            : req.user.id;

        const today = new Date().toISOString().split('T')[0];

        const { data: record } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('employee_id', targetEmployeeId)
            .eq('date', today)
            .single();

        if (!record || !record.login_time) {
            return res.status(400).json({ msg: 'Must clock in first' });
        }

        if (record.logout_time) {
            return res.status(400).json({ msg: 'Already clocked out today' });
        }

        // Check if currently on break -> Auto-end break
        let metadata = record.metadata || {};
        let breaks = metadata.breaks || [];
        const activeBreakIndex = breaks.findIndex(b => !b.endTime);
        const logoutTime = new Date().toISOString();

        if (activeBreakIndex !== -1) {
            breaks[activeBreakIndex].endTime = logoutTime;
            breaks[activeBreakIndex].autoEnded = true; // Flag for audit
            metadata.breaks = breaks;
        }

        const { auto: isAutoLogout, remarks } = req.body;
        const loginDate = new Date(record.login_time);
        const logoutDate = new Date(logoutTime);

        // Calculate Total Break Duration
        const totalBreakMilliseconds = breaks.reduce((acc, b) => {
            if (b.startTime && b.endTime) {
                return acc + (new Date(b.endTime) - new Date(b.startTime));
            }
            return acc;
        }, 0);

        const totalDurationMs = logoutDate - loginDate;
        const workingMs = totalDurationMs - totalBreakMilliseconds;
        const workingHours = (workingMs / (1000 * 60 * 60)).toFixed(2);

        const updatePayload = {
            logout_time: logoutTime,
            working_hours: Math.max(0, parseFloat(workingHours)),
            metadata: metadata // Save updated breaks
        };

        if (isAutoLogout) {
            metadata.auto_logout = true;
            updatePayload.metadata = metadata;
            updatePayload.remarks = remarks || 'Auto-logout due to inactivity';
        }

        const { error } = await supabase
            .from('attendance_logs')
            .update(updatePayload)
            .eq('id', record.id);

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'CLOCK_OUT',
            metadata: {
                target: targetEmployeeId,
                date: today,
                time: logoutTime,
                hours: workingHours,
                breakDurationMinutes: (totalBreakMilliseconds / 60000).toFixed(0)
            },
            ip: req.ip
        });

        res.json({
            msg: 'Clocked out successfully',
            logout_time: logoutTime,
            working_hours: workingHours,
            break_time_minutes: (totalBreakMilliseconds / 60000).toFixed(0)
        });
    } catch (err) {
        logger.error(`Clock-out error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   POST /api/attendance/break/start
// @desc    Start a break (Lunch, Tea, Personal)
exports.startBreak = async (req, res) => {
    try {
        const { type } = req.body; // 'LUNCH', 'TEA', 'BIO', 'OTHER'
        const employeeId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        const { data: record } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('date', today)
            .single();

        if (!record || !record.login_time) return res.status(400).json({ msg: 'You must clock in first' });
        if (record.logout_time) return res.status(400).json({ msg: 'You have already clocked out' });

        let metadata = record.metadata || {};
        let breaks = metadata.breaks || [];

        // Check if already on break
        if (breaks.some(b => !b.endTime)) {
            return res.status(400).json({ msg: 'You are already on a break. End it first.' });
        }

        const newBreak = {
            id: Date.now().toString(),
            type: type || 'OTHER',
            startTime: new Date().toISOString(),
            endTime: null
        };

        breaks.push(newBreak);
        metadata.breaks = breaks;

        const { error } = await supabase
            .from('attendance_logs')
            .update({ metadata }) // Update JSONB column
            .eq('id', record.id);

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'BREAK_START',
            metadata: { type: newBreak.type, time: newBreak.startTime },
            ip: req.ip
        });

        res.json({ msg: 'Break started', break: newBreak });
    } catch (err) {
        logger.error(`Start Break Error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   POST /api/attendance/break/end
// @desc    End the current break
exports.endBreak = async (req, res) => {
    try {
        const employeeId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        const { data: record } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('employee_id', employeeId)
            .eq('date', today)
            .single();

        if (!record) return res.status(404).json({ msg: 'Attendance record not found' });

        let metadata = record.metadata || {};
        let breaks = metadata.breaks || [];
        const activeIndex = breaks.findIndex(b => !b.endTime);

        if (activeIndex === -1) {
            return res.status(400).json({ msg: 'You are not currently on a break' });
        }

        const endTime = new Date().toISOString();
        breaks[activeIndex].endTime = endTime;

        // Calculate duration for this break
        const durationMs = new Date(endTime) - new Date(breaks[activeIndex].startTime);
        breaks[activeIndex].durationMinutes = (durationMs / 60000).toFixed(1);

        metadata.breaks = breaks;

        const { error } = await supabase
            .from('attendance_logs')
            .update({ metadata })
            .eq('id', record.id);

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'BREAK_END',
            metadata: { duration: breaks[activeIndex].durationMinutes, time: endTime },
            ip: req.ip
        });

        res.json({ msg: 'Break ended', break: breaks[activeIndex] });
    } catch (err) {
        logger.error(`End Break Error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   GET /api/attendance/:employeeId/monthly
// @desc    Get monthly attendance summary
exports.getMonthlyAttendance = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { month, year, startDate: qStartDate, endDate: qEndDate, dept, role, status, search } = req.query;
        const user = req.user;

        // 1. Authorization Check
        if (user.role !== 'super_admin' && user.id !== employeeId) {
            // Check if user is a Dept Admin
            const isDeptAdmin = ['counselling_admin', 'admission_admin', 'wfh_admin', 'admin'].includes(user.role);

            if (employeeId === 'ALL') {
                if (!isDeptAdmin) {
                    return res.status(403).json({ msg: 'Unauthorized to view global attendance' });
                }
                // Allowed for Dept Admins, they will see their own department data due to subsequent filters in query
            } else {
                // Check if Dept Admin looking at their own dept
                const { data: targetEmp } = await supabase
                    .from('employees')
                    .select('department_id')
                    .eq('id', employeeId)
                    .single();

                const userDeptId = user.department_id || user.departmentId;

                if (!isDeptAdmin || targetEmp?.department_id !== userDeptId) {
                    logger.warn(`[AUTH] Unauthorized attendance access attempt by ${user.email}. UserDept: ${userDeptId}, TargetDept: ${targetEmp?.department_id}`);
                    return res.status(403).json({ msg: 'Access denied: You can only view attendance for your department.' });
                }
            }
        }

        // 2. Date Range Logic
        let startDate, endDate;
        if (qStartDate && qEndDate) {
            startDate = qStartDate;
            endDate = qEndDate;
        } else if (month && year) {
            startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            endDate = new Date(year, month, 0).toISOString().split('T')[0];
        } else {
            const now = new Date();
            const m = now.getMonth() + 1;
            const y = now.getFullYear();
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            endDate = new Date(y, m, 0).toISOString().split('T')[0];
        }

        let query = supabase
            .from('attendance_logs')
            .select(`
                *,
                employee:employee_id!inner(
                    id, 
                    name, 
                    employee_id, 
                    department_id,
                    department:department_id(id, name, code),
                    role:role_id(id, name)
                )
            `)
            .gte('date', startDate)
            .lte('date', endDate);

        // 3. Apply Core Filters
        if (employeeId !== 'ALL') {
            query = query.eq('employee_id', employeeId);
        } else {
            if (user.role === 'super_admin') {
                // EXCLUDE SELF: Super Admin should not see their own attendance in reports
                query = query.neq('employee_id', user.id);
            } else {
                const deptId = user.departmentId || user.department_id;
                if (deptId) query = query.eq('dept_snapshot', deptId);
            }
        }

        // 4. Advanced Admin Filters
        if (dept && dept !== 'ALL') {
            // Filter by joined department code
            query = query.eq('employee.department.code', dept);
        }

        if (role && role !== 'ALL') {
            // Filter by joined role name (case insensitive for safety)
            query = query.ilike('employee.role.name', role);
        }

        if (status) {
            if (status === 'ACTIVE') query = query.is('logout_time', null);
            else if (status === 'COMPLETED') query = query.not('logout_time', 'is', null);
            else if (status === 'AUTO') query = query.contains('metadata', { auto_checkout: true });
        }

        if (search) {
            // Search across multiple fields on the joined employee record
            // Use the joined table name 'employees' or alias 'employee' explicitly in a unified OR
            query = query.or(`name.ilike.%${search}%,employee_id.ilike.%${search}%`, { foreignTable: 'employee' });
        }

        const { data: logs, error } = await query.order('date', { ascending: false });

        if (error) {
            // FALLBACK: If the join fails due to missing role logic in join or similar
            if (error.code === '42703' || error.message.includes('column')) {
                logger.warn('[SCHEMA_FALLBACK] Complex query failed. Retrying basic attendance fetch.');
                const { data: simpleLogs, error: simpleError } = await supabase
                    .from('attendance_logs')
                    .select('*')
                    .gte('date', startDate)
                    .lte('date', endDate)
                    .order('date', { ascending: false });

                if (simpleError) throw simpleError;
                return res.json({ logs: simpleLogs, summary: { daysPresent: 0, totalHours: 0, avgHours: 0 } });
            }
            throw error;
        }

        // Map employee data flattening for frontend
        const formattedLogs = (logs || []).map(log => {
            const emp = log.employee;
            return {
                ...log,
                employee: emp ? {
                    ...emp,
                    role: emp.role?.name || emp.role_snapshot || 'Executive',
                    department: emp.department?.name || log.dept_snapshot
                } : null
            };
        });

        // Calculate summary
        const daysPresent = formattedLogs.filter(log => log.login_time).length;
        const totalHours = formattedLogs.reduce((sum, log) => sum + (log.working_hours || 0), 0);
        const avgHours = daysPresent > 0 ? (totalHours / daysPresent).toFixed(2) : 0;

        res.json({
            logs: formattedLogs,
            summary: {
                daysPresent,
                totalHours: totalHours.toFixed(2),
                avgHours
            }
        });
    } catch (err) {
        logger.error(`Get attendance error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   GET /api/attendance/:employeeId/history
// @desc    Get full attendance history
exports.getAttendanceHistory = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { limit = 30 } = req.query;

        const { data: logs, error } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('employee_id', employeeId)
            .order('date', { ascending: false })
            .limit(parseInt(limit));

        if (error) throw error;

        res.json(logs);
    } catch (err) {
        logger.error(`Get attendance history error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};
/**
 * Background Job: Auto-Checkout orphaned logs
 * Finalizes any logs that were never checked out (e.g. forgot, crash, session skip)
 */
exports.performAutoCheckout = async () => {
    try {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        // Find all logs with login but no logout from PREVIOUS days
        // We don't touch today's logs yet to allow late shifts
        const { data: orphanedLogs, error } = await supabase
            .from('attendance_logs')
            .select('*')
            .is('logout_time', null)
            .lt('date', today);

        if (error) throw error;

        if (orphanedLogs.length === 0) return { processed: 0 };

        let processed = 0;
        for (const log of orphanedLogs) {
            // Rule: Auto-checkout at 4 AM of next day (or 9 hours after login if date is old)
            // For simplicity and to avoid spanning days, we set logout to 23:59:59 of the log date
            const logDateStr = log.date;
            const autoLogoutTime = `${logDateStr}T23:59:59.000Z`;

            const loginDate = new Date(log.login_time);
            const logoutDate = new Date(autoLogoutTime);
            const workingHours = ((logoutDate - loginDate) / (1000 * 60 * 60)).toFixed(2);

            const updatePayload = {
                logout_time: autoLogoutTime,
                working_hours: Math.max(0, parseFloat(workingHours))
            };

            // Only add metadata if it's likely the column exists (not checking every time for perf)
            // But we'll try to be safe
            await supabase
                .from('attendance_logs')
                .update(updatePayload)
                .eq('id', log.id);

            processed++;
        }

        logger.info(`[AUTO_CHECKOUT] Finalized ${processed} orphaned attendance logs.`);
        return { processed };
    } catch (err) {
        logger.error(`[AUTO_CHECKOUT] Critical Failure: ${err.message}`);
        return { error: err.message };
    }
};

// @route   PATCH /api/attendance/:logId
// @desc    Admin: Manually update an attendance log
exports.updateAttendance = async (req, res) => {
    try {
        const { logId } = req.params;
        const { login_time, logout_time, remarks } = req.body;
        const user = req.user;

        // AUTH: Only admins can adjust logs
        if (!['super_admin', 'counselling_admin', 'admission_admin', 'wfh_admin', 'admin'].includes(user.role)) {
            return res.status(403).json({ msg: 'Only administrators can manually adjust attendance logs' });
        }

        const updateData = {};
        if (login_time) updateData.login_time = login_time;
        if (logout_time) updateData.logout_time = logout_time;
        if (remarks) updateData.remarks = remarks;

        // If times are updated, recalculate working hours
        if (login_time || logout_time) {
            const { data: current } = await supabase.from('attendance_logs').select('*').eq('id', logId).single();
            const logIn = login_time || current.login_time;
            const logOut = logout_time || current.logout_time;

            if (logIn && logOut) {
                const diff = (new Date(logOut) - new Date(logIn)) / (1000 * 60 * 60);
                updateData.working_hours = parseFloat(Math.max(0, diff).toFixed(2));
            }
        }

        const { data, error } = await supabase
            .from('attendance_logs')
            .update(updateData)
            .eq('id', logId)
            .select();

        if (error) throw error;

        await auditService.logAction({
            employeeId: user.id,
            action: 'ATTENDANCE_ADJUSTMENT',
            metadata: { logId, updates: updateData },
            ip: req.ip
        });

        res.json({ msg: 'Attendance record updated', log: data[0] });
    } catch (err) {
        logger.error(`Update attendance error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   POST /api/attendance/export
// @desc    Export attendance logs
exports.exportAttendanceReport = async (req, res) => {
    try {
        const { startDate, endDate, department } = req.body;

        let query = supabase
            .from('attendance_logs')
            .select('*, employee:employee_id(*, role(*), department(*))')
            .gte('date', startDate)
            .lte('date', endDate)
            .order('date', { ascending: false });

        if (department) {
            query = query.eq('employee.department_id', department);
        }

        const { data: logs, error } = await query;

        if (error) {
            logger.error(`Export query error: ${error.message}`);
            throw error;
        }

        // Map employee data flattening for frontend, similar to getAttendance
        const results = (logs || []).map(log => {
            const emp = log.employee;
            return {
                ...log,
                employee: emp ? {
                    ...emp,
                    role: emp.role?.name || emp.role_snapshot || 'Executive',
                    department: emp.department?.name || log.dept_snapshot
                } : null
            };
        });

        // In a real implementation, we'd generate a CSV/XLSX
        // For now, we'll return a simulated URL as expected by the frontend
        // Return processed results for frontend/service to handle export
        res.status(200).json({
            success: true,
            msg: `Attendance report generated for ${results.length} records.`,
            data: results
        });
    } catch (err) {
        logger.error(`Export error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};
