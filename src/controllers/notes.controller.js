const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');

// @route   GET /api/employees/:id/notes
// @desc    Get all notes for an employee (with RBAC)
exports.getNotes = async (req, res) => {
    try {
        const { id } = req.params;
        const viewerId = req.user.id;

        // 1. Get Viewer Role
        const { data: viewer, error: viewerError } = await supabase
            .from('employees')
            .select('id, is_admin, roles(name)')
            .eq('id', viewerId)
            .single();

        if (viewerError || !viewer) return res.status(401).json({ msg: 'Unauthorized' });

        const roleName = viewer.roles?.name || '';
        const isSuperAdmin = viewer.is_admin || roleName.toLowerCase().includes('super administrator') || roleName.toLowerCase() === 'super_admin';

        // 2. Permission Check
        let query = supabase
            .from('employee_notes')
            .select(`
                *,
                author:employees!author_id(name)
            `)
            .eq('employee_id', id)
            .order('created_at', { ascending: false });

        if (viewerId === id) {
            // Employee viewing their own notes
            query = query.eq('is_visible_to_employee', true);
        } else if (!isSuperAdmin) {
            // Not Super Admin and not self
            return res.status(403).json({ msg: 'Access denied: You can only view your own notes.' });
        }
        // Super Admin sees all (no extra filter)

        const { data: notes, error } = await query;
        if (error) throw error;

        const formatted = notes.map(note => ({
            id: note.id,
            content: note.content,
            author_id: note.author_id,
            author_name: note.author?.name || 'Management',
            is_visible_to_employee: note.is_visible_to_employee,
            status_tag: note.status_tag || 'Info',
            created_at: note.created_at,
            updated_at: note.updated_at
        }));

        res.json(formatted);
    } catch (err) {
        logger.error(`Get notes error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   POST /api/employees/:id/notes
// @desc    Create a new note
exports.createNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { content, is_visible_to_employee, status_tag } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ msg: 'Note content is required' });
        }

        // Only Super Admin can create notes
        const { data: employee } = await supabase.from('employees').select('is_admin, roles(name)').eq('id', req.user.id).single();
        const roleName = employee?.roles?.name || '';
        if (!employee?.is_admin && !roleName.toLowerCase().includes('super')) {
            return res.status(403).json({ msg: 'Only Super Admins can create employee notes' });
        }

        const { data: note, error } = await supabase
            .from('employee_notes')
            .insert({
                employee_id: id,
                content: content.trim(),
                author_id: req.user.id,
                is_visible_to_employee: !!is_visible_to_employee,
                status_tag: status_tag || 'Info'
            })
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'NOTE_CREATED',
            metadata: { target_employee_id: id, visible: !!is_visible_to_employee },
            ip: req.ip
        });

        res.json(note);
    } catch (err) {
        logger.error(`Create note error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   PUT /api/employees/:id/notes/:noteId
// @desc    Update a note
exports.updateNote = async (req, res) => {
    try {
        const { id, noteId } = req.params;
        const { content, is_visible_to_employee, status_tag } = req.body;

        // Admin Check
        const { data: employee } = await supabase.from('employees').select('is_admin, roles(name)').eq('id', req.user.id).single();
        const roleName = employee?.roles?.name || '';
        if (!employee?.is_admin && !roleName.toLowerCase().includes('super')) {
            return res.status(403).json({ msg: 'Only Super Admins can update employee notes' });
        }

        const { data: note, error } = await supabase
            .from('employee_notes')
            .update({
                content: content?.trim(),
                is_visible_to_employee: is_visible_to_employee !== undefined ? !!is_visible_to_employee : undefined,
                status_tag: status_tag,
                updated_at: new Date().toISOString()
            })
            .eq('id', noteId)
            .eq('employee_id', id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'NOTE_UPDATED',
            metadata: { note_id: noteId, target_employee_id: id },
            ip: req.ip
        });

        res.json(note);
    } catch (err) {
        logger.error(`Update note error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};

// @route   DELETE /api/employees/:id/notes/:noteId
// @desc    Delete a note
exports.deleteNote = async (req, res) => {
    try {
        const { id, noteId } = req.params;

        // Admin Check
        const { data: employee } = await supabase.from('employees').select('is_admin, roles(name)').eq('id', req.user.id).single();
        const roleName = employee?.roles?.name || '';
        if (!employee?.is_admin && !roleName.toLowerCase().includes('super')) {
            return res.status(403).json({ msg: 'Only Super Admins can delete employee notes' });
        }

        const { error } = await supabase
            .from('employee_notes')
            .delete()
            .eq('id', noteId)
            .eq('employee_id', id);

        if (error) throw error;

        await auditService.logAction({
            employeeId: req.user.id,
            action: 'NOTE_DELETED',
            metadata: { note_id: noteId, target_employee_id: id },
            ip: req.ip
        });

        res.json({ msg: 'Note deleted successfully' });
    } catch (err) {
        logger.error(`Delete note error: ${err.message}`);
        res.status(500).json({ error: 'Server Error' });
    }
};
