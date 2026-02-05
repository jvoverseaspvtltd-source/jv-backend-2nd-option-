const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');
const auditService = require('../services/audit.service');
const { uploadToSupabase, deleteFromSupabase, generateSignedUrl } = require('../middleware/storage.middleware');

/**
 * 1. CREATE MATERIAL
 * Handles upload and metadata assignment
 */
exports.createMaterial = async (req, res) => {
    try {
        const {
            title, description, category, is_external, external_url,
            visibility_type, department_id, role_id, priority, tags,
            download_allowed, expiry_date
        } = req.body;

        const employee_id = req.user.id;
        let file_url = external_url;
        let file_path = null;
        let file_type = 'LINK';

        // Process File Upload if present
        if (req.file) {
            const uploadResult = await uploadToSupabase(req.file);
            file_path = uploadResult.path;
            file_url = null; // Will use signed URLs from path
            file_type = uploadResult.extension;
        }

        const { data, error } = await supabase
            .from('study_materials')
            .insert([{
                title, description, category,
                file_url,
                file_path,
                file_type: req.file ? file_type : (req.body.file_type || 'LINK'),
                is_external: is_external === 'true' || is_external === true,
                external_url: is_external === 'true' ? external_url : null,
                visibility_type: visibility_type || 'ALL',
                department_id,
                role_id,
                priority: priority || 'MEDIUM',
                tags: typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : (tags || []),
                download_allowed: download_allowed === 'false' ? false : true,
                expiry_date,
                created_by: employee_id,
                updated_by: employee_id
            }])
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            action: 'STUDY_MATERIAL_CREATE',
            user_id: employee_id,
            metadata: { material_id: data.id, title, file_path },
            ip: req.ip
        });

        res.status(201).json(data);
    } catch (err) {
        logger.error(`Create Material Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to create material', error: err.message });
    }
};

/**
 * 2. LIST MATERIALS (Filtered by permissions)
 */
exports.getMaterials = async (req, res) => {
    try {
        const { id: employee_id, role, department_id: empDeptId, role_id: empRoleId } = req.user;
        const { category, search, department_id, status } = req.query;

        // 1. Ensure we have the user's department/role UUIDs
        let userDeptId = empDeptId;
        let userRoleId = empRoleId;

        if (!userDeptId && role !== 'super_admin' && role !== 'SUPER_ADMIN') {
            const { data: empDetails } = await supabase
                .from('employees')
                .select('department_id, role_id')
                .eq('id', employee_id)
                .single();
            if (empDetails) {
                userDeptId = empDetails.department_id;
                userRoleId = empDetails.role_id;
            }
        }

        // 2. Build Query
        let query = supabase.from('study_materials').select('*');

        // 3. Apply Filters
        if (role !== 'super_admin' && role !== 'SUPER_ADMIN') {
            query = query.eq('status', 'PUBLISHED').eq('is_active', true);
            const now = new Date().toISOString();
            query = query.or(`expiry_date.is.null,expiry_date.gt.${now}`);

            let filterString = 'visibility_type.eq.ALL';
            if (userDeptId) filterString += `,and(visibility_type.eq.DEPARTMENT,department_id.eq.${userDeptId})`;
            if (userRoleId) filterString += `,and(visibility_type.eq.ROLE,role_id.eq.${userRoleId})`;
            query = query.or(filterString);
        } else if (status) {
            query = query.eq('status', status);
        }

        if (category && category !== 'All') query = query.eq('category', category);
        if (department_id) query = query.eq('department_id', department_id);
        if (req.query.created_by) query = query.eq('created_by', req.query.created_by);
        if (search) query = query.ilike('title', `%${search}%`);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
            logger.error(`Supabase Fetch Error: ${error.message}`);
            return res.status(500).json({ msg: 'Database query failed' });
        }

        // 4. Enrichment & Signed URLs
        const enriched = await Promise.all((data || []).map(async (mat) => {
            const result = { ...mat };

            // Generate Signed URL for private files
            if (mat.file_path) {
                result.file_url = await generateSignedUrl(mat.file_path);
            }

            // Fetch creator name (cached/joined would be better but keeping consistency here)
            if (mat.created_by) {
                const { data: creator } = await supabase.from('employees').select('name').eq('id', mat.created_by).single();
                result.created_by = creator || { name: 'Admin' };
            }
            if (mat.department_id) {
                const { data: dept } = await supabase.from('departments').select('name').eq('id', mat.department_id).single();
                result.department = dept || { name: 'Internal' };
            }

            return result;
        }));

        res.json(enriched);
    } catch (err) {
        logger.error(`Get Materials Global Error: ${err.message}`);
        res.status(500).json({ msg: 'Internal Server Error' });
    }
};

/**
 * 3. UPDATE MATERIAL
 */
exports.updateMaterial = async (req, res) => {
    try {
        const { id } = req.params;
        const employee_id = req.user.id;

        // 1. Fetch current record for cleanup
        const { data: current } = await supabase.from('study_materials').select('*').eq('id', id).single();
        if (!current) return res.status(404).json({ msg: 'Material not found' });

        const updates = { ...req.body };
        updates.updated_by = employee_id;

        // 2. Handle File Replacement
        if (req.file) {
            // Delete old file if it exists
            if (current.file_path) {
                await deleteFromSupabase(current.file_path);
            }

            const uploadResult = await uploadToSupabase(req.file);
            updates.file_path = uploadResult.path;
            updates.file_url = null;
            updates.file_type = uploadResult.extension;
            updates.is_external = false;
        }

        // Map Booleans if stringified by FormData
        if (updates.is_external !== undefined) updates.is_external = updates.is_external === 'true' || updates.is_external === true;
        if (updates.download_allowed !== undefined) updates.download_allowed = updates.download_allowed === 'true' || updates.download_allowed === true;

        const { data, error } = await supabase
            .from('study_materials')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        await auditService.logAction({
            action: 'STUDY_MATERIAL_UPDATE',
            user_id: employee_id,
            metadata: { material_id: id, title: data.title, file_changed: !!req.file },
            ip: req.ip
        });

        res.json(data);
    } catch (err) {
        logger.error(`Update Material Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to update material' });
    }
};

/**
 * 4. TRACK ENGAGEMENT (View/Download)
 */
exports.trackEngagement = async (req, res) => {
    try {
        const { id: material_id } = req.params;
        const { action, duration } = req.body;
        const employee_id = req.user.id;

        const { error } = await supabase
            .from('study_material_engagements')
            .insert([{
                material_id,
                employee_id,
                action: action.toUpperCase(),
                duration_seconds: duration || 0
            }]);

        if (error) throw error;

        if (action.toUpperCase() === 'COMPLETE') {
            await supabase
                .from('study_material_completions')
                .upsert([{ material_id, employee_id }], { onConflict: 'material_id,employee_id' });
        }

        res.json({ success: true });
    } catch (err) {
        logger.error(`Track Engagement Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to track engagement' });
    }
};

/**
 * 5. TOGGLE BOOKMARK
 */
exports.toggleBookmark = async (req, res) => {
    try {
        const { id: material_id } = req.params;
        const employee_id = req.user.id;

        const { data: existing } = await supabase
            .from('study_material_bookmarks')
            .select('id')
            .match({ material_id, employee_id })
            .maybeSingle();

        if (existing) {
            await supabase.from('study_material_bookmarks').delete().eq('id', existing.id);
            return res.json({ bookmarked: false });
        } else {
            await supabase.from('study_material_bookmarks').insert([{ material_id, employee_id }]);
            return res.json({ bookmarked: true });
        }
    } catch (err) {
        logger.error(`Toggle Bookmark Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to toggle bookmark' });
    }
};

/**
 * 6. DELETE MATERIAL
 */
exports.deleteMaterial = async (req, res) => {
    try {
        const { id } = req.params;
        const employee_id = req.user.id;

        // 1. Fetch for storage cleanup
        const { data: material } = await supabase.from('study_materials').select('*').eq('id', id).single();

        if (material && material.file_path) {
            await deleteFromSupabase(material.file_path);
        }

        // 2. Delete DB record
        const { error } = await supabase.from('study_materials').delete().eq('id', id);
        if (error) throw error;

        await auditService.logAction({
            action: 'STUDY_MATERIAL_DELETE',
            user_id: employee_id,
            metadata: { material_id: id, title: material?.title },
            ip: req.ip
        });

        res.json({ msg: 'Material deleted successfully' });
    } catch (err) {
        logger.error(`Delete Material Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to delete material' });
    }
};

/**
 * 7. GET SECURE LINK (On-demand signing for session stability)
 */
exports.getMaterialLink = async (req, res) => {
    try {
        const { id } = req.params;
        const { id: employee_id } = req.user;

        const { data: material, error } = await supabase
            .from('study_materials')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !material) return res.status(404).json({ msg: 'Material not found' });

        // Generate a fresh signature valid for 1 hour
        let secureUrl = material.file_url;
        if (material.file_path) {
            secureUrl = await generateSignedUrl(material.file_path);
        }

        res.json({ url: secureUrl });
    } catch (err) {
        logger.error(`Get Secure Link Error: ${err.message}`);
        res.status(500).json({ msg: 'Failed to generate secure link' });
    }
};
