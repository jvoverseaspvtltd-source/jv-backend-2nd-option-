const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');
const supabase = require('../config/supabaseClient'); // Import Supabase Client

class ImageService {
    constructor() {
        this.bucket = 'profiles'; // Supabase Bucket Name
    }

    // No longer needed to ensure local directories
    async ensureUploadDir() {
        return true;
    }

    // No longer needed for cloud storage, but kept empty for compatibility if called
    async createEmployeeStorage(employeeId) {
        return null;
    }

    /**
     * Process and optimize profile photo, then upload to Supabase
     * @param {Buffer} buffer - Image buffer from multer
     * @param {string} originalName - Original filename
     * @returns {Promise<{filename: string, path: string, size: number}>}
     */
    async processProfilePhoto(buffer, originalName) {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = crypto.randomBytes(8).toString('hex');
        const filename = `profile_${timestamp}_${randomString}.webp`;
        const filePath = `${filename}`; // Store at root of bucket or use 'profiles/' prefix if shared bucket

        // Process image: resize and compress
        const processedImageBuffer = await sharp(buffer)
            .resize(400, 400, {
                fit: 'cover',
                position: 'center'
            })
            .webp({
                quality: 80,
                effort: 6
            })
            .toBuffer();

        // Upload to Supabase
        const { data, error } = await supabase.storage
            .from(this.bucket)
            .upload(filePath, processedImageBuffer, {
                contentType: 'image/webp',
                upsert: false
            });

        if (error) {
            console.error('Supabase Upload Error:', error);
            throw new Error('Failed to upload profile photo to cloud storage.');
        }

        // Get Public URL
        const { data: publicData } = supabase.storage
            .from(this.bucket)
            .getPublicUrl(filePath);

        return {
            filename,
            path: publicData.publicUrl, // Returns https://.../profile_...webp
            size: processedImageBuffer.length
        };
    }

    /**
     * Delete old profile photo from Supabase
     * @param {string} photoUrl - Full URL or path
     */
    async deleteProfilePhoto(photoUrl) {
        if (!photoUrl) return;

        try {
            // Extract filename from URL
            // Format: https://xyz.supabase.co/.../profiles/filename.webp
            // or just filename.webp if legacy

            const parts = photoUrl.split('/');
            const filename = parts[parts.length - 1]; // Get last segment

            if (!filename) return;

            const { error } = await supabase.storage
                .from(this.bucket)
                .remove([filename]);

            if (error) {
                console.error('Failed to delete old photo from Supabase:', error.message);
            }
        } catch (error) {
            console.error('Delete photo error:', error);
        }
    }
}

module.exports = new ImageService();
