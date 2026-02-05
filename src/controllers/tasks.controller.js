const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');
const notificationService = require('../services/notification.service');

// 1. CREATE TASK
exports.createTask = async (req, res) => {
    try {
        const { title, description, assigned_to, due_date, priority, visibility_type, department_id } = req.body;
        const creator_id = req.user.id;
        const creator_name = req.user.name || 'Admin';
        const creator_role = req.user.role?.toUpperCase();

        // 🛡️ Security Check: Only Super Admin can create GLOBAL tasks
        if (visibility_type === 'GLOBAL' && creator_role !== 'SUPER_ADMIN') {
            return res.status(403).json({ msg: 'Only Super Admin can create global tasks' });
        }

        // 🛡️ Security Check: Dept Admin can only create tasks for their own department
        if (creator_role === 'DEPT_ADMIN' && visibility_type === 'DEPARTMENT' && department_id !== req.user.dept) {
            return res.status(403).json({ msg: 'You can only create tasks for your own department' });
        }

        const { data, error } = await supabase
            .from('tasks')
            .insert([{
                title,
                description,
                assigned_to: assigned_to || null,
                due_date,
                priority: priority || 'MEDIUM',
                visibility_type: visibility_type || 'INDIVIDUAL',
                department_id: visibility_type === 'GLOBAL' ? null : (department_id || req.user.dept),
                created_by: creator_id
            }])
            .select()
            .single();

        if (error) throw error;

        // 📝 Log Audit
        await supabase.from('task_audit_logs').insert([{
            task_id: data.id,
            action: 'CREATED',
            performed_by: creator_id,
            new_value: title,
            metadata: { visibility_type, assigned_to, department_id }
        }]);

        // 📢 Trigger Notifications
        const notifPayload = {
            sender_id: creator_id,
            title: `New Task Assigned: ${title}`,
            message: `You have been assigned a new task by ${creator_name}. Priority: ${priority}`,
            type: 'TASK',
            priority: priority,
            link: `/tasks/${data.id}`
        };

        if (visibility_type === 'INDIVIDUAL' && assigned_to) {
            await notificationService.send({ ...notifPayload, recipient_id: assigned_to });
        } else if (visibility_type === 'DEPARTMENT' && (department_id || req.user.dept)) {
            await notificationService.notifyDepartment({
                ...notifPayload,
                department_id: department_id || req.user.dept,
                message: `A new department-wide task was published: ${title}`
            });
        }

        await auditService.logAction({
            action: 'TASK_CREATE',
            user_id: creator_id,
            metadata: { task_id: data.id, title },
            ip: req.ip
        });

        res.status(201).json(data);
    } catch (err) {
        logger.error(`Create Task Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// 2. GET TASKS (Advanced RBAC & Visibility)
exports.getTasks = async (req, res) => {
    try {
        const { role, id: employee_id, dept } = req.user;
        const { category, search, department_id, status, page = 1, limit = 50 } = req.query;
        const uRole = role?.toUpperCase();

        // 1. Ensure we have the user's department/role UUIDs
        let userDeptId = dept;
        if (!userDeptId && uRole !== 'SUPER_ADMIN') {
            const { data: empDetails } = await supabase.from('employees').select('department_id').eq('id', employee_id).single();
            userDeptId = empDetails?.department_id;
        }

        // 2. Build Query
        let query = supabase.from('tasks').select(`
            *,
            assigned_to:employees!assigned_to(id, name, email),
            department:departments(id, name),
            created_by:employees!created_by(id, name)
        `, { count: 'exact' });

        // 3. Apply Filters
        if (uRole !== 'SUPER_ADMIN') {
            let filterString = `assigned_to.eq.${employee_id},visibility_type.eq.GLOBAL`;
            if (userDeptId) filterString += `,and(visibility_type.eq.DEPARTMENT,department_id.eq.${userDeptId})`;
            query = query.or(filterString);
        }

        if (department_id) query = query.eq('department_id', department_id);
        if (status) query = query.eq('status', status);
        if (search) query = query.ilike('title', `%${search}%`);

        // Pagination
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        query = query.range(from, to).order('created_at', { ascending: false });

        const { data, error, count } = await query;
        if (error) throw error;

        // 🕒 On-the-fly Overdue Identification
        const processedTasks = data.map(task => {
            const isLate = task.due_date && new Date(task.due_date) < new Date();
            if (isLate && task.status !== 'COMPLETED' && task.status !== 'OVERDUE') {
                return { ...task, status: 'OVERDUE' };
            }
            return task;
        });

        res.json(processedTasks);
    } catch (err) {
        logger.error(`Get Tasks Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error', details: err.message });
    }
};

// 3. UPDATE TASK STATUS (Hardened Security)
exports.updateTaskStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note } = req.body;
        const { id: employee_id, role, dept } = req.user;
        const uRole = role?.toUpperCase();

        // 🛡️ Security Check: Fetch task to verify ownership
        const { data: task } = await supabase.from('tasks').select('*').eq('id', id).single();
        if (!task) return res.status(404).json({ msg: 'Task not found' });

        const isAssignee = task.assigned_to === employee_id;
        const isAdmin = uRole === 'SUPER_ADMIN' || (uRole === 'DEPT_ADMIN' && task.department_id === dept);

        if (!isAssignee && !isAdmin) {
            return res.status(403).json({ msg: 'Unauthorized to update this task status' });
        }

        const { data, error } = await supabase
            .from('tasks')
            .update({
                status,
                updated_at: new Date()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // 📝 Log Audit
        await supabase.from('task_audit_logs').insert([{
            task_id: id,
            action: 'STATUS_CHANGE',
            performed_by: employee_id,
            old_value: task.status,
            new_value: status,
            metadata: { note }
        }]);

        await auditService.logAction({
            action: 'TASK_STATUS_UPDATE',
            user_id: employee_id,
            metadata: { task_id: id, status, prev_status: task.status },
            ip: req.ip
        });

        res.json(data);
    } catch (err) {
        logger.error(`Update Task Status Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// 4. FULL UPDATE TASK (Admin Only)
exports.updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const employee_id = req.user.id;

        const { data: oldTask } = await supabase.from('tasks').select('*').eq('id', id).single();
        if (!oldTask) return res.status(404).json({ msg: 'Task not found' });

        const { data, error } = await supabase
            .from('tasks')
            .update({
                ...updates,
                updated_at: new Date()
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // 📝 Log Audit for change
        await supabase.from('task_audit_logs').insert([{
            task_id: id,
            action: 'EDITED',
            performed_by: employee_id,
            old_value: oldTask.title,
            new_value: data.title,
            metadata: { updates }
        }]);

        await auditService.logAction({
            action: 'TASK_EDIT',
            user_id: employee_id,
            metadata: { task_id: id, updates },
            ip: req.ip
        });

        res.json(data);
    } catch (err) {
        logger.error(`Edit Task Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// 5. DELETE TASK (Admin Only)
exports.deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        const employee_id = req.user.id;

        const { data: task } = await supabase.from('tasks').select('title').eq('id', id).single();

        const { error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) throw error;

        await auditService.logAction({
            action: 'TASK_DELETE',
            user_id: employee_id,
            metadata: { task_id: id, title: task?.title },
            ip: req.ip
        });

        res.json({ msg: 'Task purged from records' });
    } catch (err) {
        logger.error(`Delete Task Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// 6. GET TASK HISTORY
exports.getTaskHistory = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('task_audit_logs')
            .select(`
                *,
                performed_by:employees(id, name)
            `)
            .eq('task_id', id)
            .order('timestamp', { ascending: false });

        if (error) throw error;

        res.json(data);
    } catch (err) {
        logger.error(`Get Task History Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};
