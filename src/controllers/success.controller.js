const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');

// 1. CREATE SUCCESS RECORD
exports.createSuccessRecord = async (req, res) => {
    try {
        const { title, description, user_id, user_type, achievement_date, department_id } = req.body;
        const employee_id = req.user.id;

        const { data, error } = await supabase
            .from('success_records')
            .insert([{
                title,
                description,
                user_id,
                user_type,
                achievement_date,
                department_id,
                created_at: new Date()
            }])
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            action: 'SUCCESS_RECORD_CREATE',
            user_id: employee_id,
            metadata: { record_id: data.id, title },
            ip: req.ip
        });

        res.status(201).json(data);
    } catch (err) {
        logger.error(`Create Success Record Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};

// 2. GET SUCCESS RECORDS
exports.getSuccessRecords = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('success_records')
            .select('*')
            .order('achievement_date', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        logger.error(`Get Success Records Error: ${err.message}`);
        res.status(500).json({ msg: 'Server Error' });
    }
};
