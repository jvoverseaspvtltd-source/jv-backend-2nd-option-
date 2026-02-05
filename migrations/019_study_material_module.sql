-- ============================================================================
-- 019_STUDY_MATERIAL_MODULE.SQL
-- Production-grade Notes & Study Material Management System
-- ============================================================================

-- 1. STUDY MATERIALS TABLE
CREATE TABLE IF NOT EXISTS study_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) DEFAULT 'General', -- Training, SOP, Sales Script, Compliance, etc.
    file_url TEXT,
    file_type VARCHAR(50), -- PDF, PPTX, DOCX, IMAGE, LINK, etc.
    is_external BOOLEAN DEFAULT FALSE,
    external_url TEXT,
    
    -- Visibility & Access
    visibility_type VARCHAR(20) DEFAULT 'ALL', -- ALL, DEPARTMENT, ROLE
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    
    -- Status & Versioning
    status VARCHAR(20) DEFAULT 'PUBLISHED', -- DRAFT, PUBLISHED, ARCHIVED
    priority VARCHAR(10) DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH
    version INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Expiry & Permissions
    publish_date TIMESTAMPTZ DEFAULT NOW(),
    expiry_date TIMESTAMPTZ,
    download_allowed BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    tags TEXT[] DEFAULT '{}',
    
    -- Audit Tracking
    created_by UUID REFERENCES employees(id),
    updated_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ENGAGEMENT TRACKING TABLE
CREATE TABLE IF NOT EXISTS study_material_engagements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id UUID REFERENCES study_materials(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL, -- VIEW, DOWNLOAD, COMPLETE
    duration_seconds INT DEFAULT 0,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BOOKMARKS TABLE
CREATE TABLE IF NOT EXISTS study_material_bookmarks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id UUID REFERENCES study_materials(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(material_id, employee_id)
);

-- 4. COMPLETION TRACKING
CREATE TABLE IF NOT EXISTS study_material_completions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    material_id UUID REFERENCES study_materials(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(material_id, employee_id)
);

-- 5. INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_study_materials_dept ON study_materials(department_id);
CREATE INDEX IF NOT EXISTS idx_study_materials_status ON study_materials(status);
CREATE INDEX IF NOT EXISTS idx_study_engagement_emp ON study_material_engagements(employee_id);
CREATE INDEX IF NOT EXISTS idx_study_engagement_mat ON study_material_engagements(material_id);

-- 6. TRIGGER FOR UPDATED_AT
CREATE OR REPLACE FUNCTION update_study_material_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_study_material_modtime
    BEFORE UPDATE ON study_materials
    FOR EACH ROW
    EXECUTE FUNCTION update_study_material_timestamp();
