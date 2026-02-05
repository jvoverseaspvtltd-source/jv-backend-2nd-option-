const multer = require('multer');
const path = require('path');
const supabase = require('../config/supabaseClient');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const logger = require('../utils/logger'); // Ensure logger is available

console.log('[DEBUG] Storage Middleware: Starting initialization...');
console.log('[DEBUG] Storage Middleware: Multer, Sharp, and PDF-Lib loaded.');

// 1. CONFIGURE MULTER
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedMimes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
        'application/msword', // DOC
        'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
        'application/vnd.ms-powerpoint', // PPT
        'image/jpeg', 'image/png', 'image/webp', 'image/svg+xml',
        'text/plain',
        'application/zip',
        'text/csv'
    ];

    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} is not supported. Supported: PDF, DOC, PPT, Images, Text.`), false);
    }
};

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB Upload Limit (handled before compression)
    fileFilter
});

// Export studyUpload IMMEDIATELY to help with circular dependencies
exports.studyUpload = upload;
console.log('[DEBUG] Storage Middleware: studyUpload exported.');

// COMPRESSION HELPERS
const compressImage = async (buffer, mimetype) => {
    try {
        let pipeline = sharp(buffer);
        const metadata = await pipeline.metadata();

        // Resize if too large (max 1500px)
        if (metadata.width > 1500 || metadata.height > 1500) {
            pipeline = pipeline.resize(1500, 1500, { fit: 'inside', withoutEnlargement: true });
        }

        // Convert to WebP or JPEG with quality reduction
        if (mimetype === 'image/png' || mimetype === 'image/webp') {
            // WebP is efficient
            return await pipeline.webp({ quality: 65, effort: 4 }).toBuffer();
        } else {
            return await pipeline.jpeg({ quality: 60, mozjpeg: true }).toBuffer();
        }
    } catch (err) {
        logger.error(`Image compression failed: ${err.message}`);
        return buffer; // Return original if compression fails
    }
};

const compressPdf = async (buffer) => {
    try {
        // Load PDF and save it (removes unused objects/history)
        // Note: Use 'ignoreEncryption' if needed, but standard files work fine
        const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

        // Basic optimization: just saving often reduces size of 'dirty' PDFs
        // For deeper compression (downsampling images), pure JS is limited.
        // We reject if still > 1MB after this cleanup.
        const compressedBytes = await pdfDoc.save();
        return Buffer.from(compressedBytes);
    } catch (err) {
        logger.error(`PDF compression failed: ${err.message}`);
        return buffer;
    }
};

// 2. SUPABASE STORAGE HELPER
const uploadToSupabase = async (file, bucket = 'study-materials') => {
    let fileBuffer = file.buffer;
    let contentType = file.mimetype;
    let extension = path.extname(file.originalname).substring(1).toUpperCase();

    // AUTOMATIC COMPRESSION LOGIC
    const MAX_SIZE = 10 * 1024 * 1024; // 10 MB (increased from 1 MB)

    if (file.mimetype.startsWith('image/')) {
        // Compress Image
        fileBuffer = await compressImage(fileBuffer, file.mimetype);
        // Force MIME to webp or jpeg if converted? 
        // For safety, we keep original mime mostly, but if we used toWebP, it becomes image/webp
        // Let's keep it simple: If we converted, we might change extension, but that breaks flows.
        // The simple compressor implementation strictly returns a buffer.
    } else if (file.mimetype === 'application/pdf') {
        // "Compress" PDF
        fileBuffer = await compressPdf(fileBuffer);
    }

    // FINAL SIZE CHECK
    if (fileBuffer.length > MAX_SIZE) {
        throw new Error(`File is too large (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB). Compression failed to bring it under 10 MB.`);
    }

    const fileName = `${uuidv4()}-${file.originalname.replace(/\s/g, '_')}`;
    const filePath = `uploads/${fileName}`;

    const { data, error } = await supabase.storage
        .from(bucket)
        .upload(filePath, fileBuffer, {
            contentType: contentType,
            upsert: false
        });

    if (error) throw error;

    return {
        path: filePath,
        fileName: file.originalname,
        extension: extension
    };
};

// 3. SECURE ACCESS & CLEANUP
const deleteFromSupabase = async (filePath, bucket = 'study-materials') => {
    if (!filePath) return;
    try {
        const { error } = await supabase.storage.from(bucket).remove([filePath]);
        if (error) logger.error(`Supabase Clear Error: ${error.message}`);
    } catch (err) {
        logger.error(`Storage Cleanup Failed: ${err.message}`);
    }
};

const generateSignedUrl = async (filePath, bucket = 'study-materials', expiresIn = 3600) => {
    if (!filePath || filePath.startsWith('http')) return filePath;

    const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(filePath, expiresIn);

    if (error) {
        logger.error(`Signed URL Error: ${error.message}`);
        return null;
    }

    return data.signedUrl;
};

exports.uploadToSupabase = uploadToSupabase;
exports.deleteFromSupabase = deleteFromSupabase;
exports.generateSignedUrl = generateSignedUrl;

console.log('[DEBUG] Storage Middleware: All exports initialized:', Object.keys(exports));
