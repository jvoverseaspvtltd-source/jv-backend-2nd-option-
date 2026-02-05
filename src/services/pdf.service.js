const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');
const logger = require('../utils/logger');

// Fixed currency formatter - removes superscript issue
const formatCurrencyINR = (value) => {
    const num = Number(value) || 0;
    // Use simple string concatenation to avoid Unicode issues
    return 'Rs ' + num.toLocaleString('en-IN', { 
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
        useGrouping: true
    });
};

const generateRegistrationPDF = (studentData, registrationId) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 30,
                bufferPages: true,
                autoFirstPage: true,
                info: {
                    Title: `Registration - ${studentData.name || studentData.fullName}`,
                    Author: 'JV Overseas CRM',
                    Subject: 'Student Registration Confirmation',
                    Keywords: 'student, registration, admission, education loan',
                    CreationDate: new Date()
                }
            });

            let buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // HEADER SECTION
            doc.rect(0, 0, doc.page.width, 70).fill('#1e3a8a');

            const logoPath = path.join(__dirname, '../../assets/logo.webp');
            if (fs.existsSync(logoPath)) {
                doc.image(logoPath, 40, 15, { width: 45 });
            }

            doc.fillColor('white')
                .font('Helvetica-Bold')
                .fontSize(16)
                .text('JV OVERSEAS', 95, 20)
                .font('Helvetica')
                .fontSize(8)
                .text('Global Education Consultants', 95, 38);

            doc.roundedRect(doc.page.width - 160, 20, 120, 30, 3).fill('#059669');
            doc.fillColor('white')
                .font('Helvetica-Bold')
                .fontSize(10)
                .text('STUDENT', doc.page.width - 160, 25, { width: 120, align: 'center' })
                .fontSize(9)
                .text('REGISTRATION', doc.page.width - 160, 38, { width: 120, align: 'center' });

            // REGISTRATION INFO
            let currentY = 85;
            doc.fillColor('#111827')
                .font('Helvetica-Bold')
                .fontSize(14)
                .text(`Registration #${registrationId}`, 40, currentY);

            doc.fillColor('#6b7280')
                .font('Helvetica')
                .fontSize(8)
                .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 40, currentY + 18);

            const status = studentData.paymentStatus || 'Pending';
            const statusColor = status === 'Paid' ? '#059669' : status === 'Partial' ? '#d97706' : '#dc2626';
            doc.roundedRect(doc.page.width - 140, currentY, 100, 20, 10).fill(statusColor);
            doc.fillColor('white')
                .font('Helvetica-Bold')
                .fontSize(9)
                .text(status.toUpperCase(), doc.page.width - 140, currentY + 5, { width: 100, align: 'center' });

            // STUDENT INFORMATION
            currentY = 120;
            doc.roundedRect(40, currentY, doc.page.width - 80, 100, 5)
                .fill('#f8fafc')
                .stroke('#e5e7eb');

            doc.fillColor('#1e3a8a')
                .font('Helvetica-Bold')
                .fontSize(11)
                .text('STUDENT INFORMATION', 50, currentY + 10);

            const col1X = 50;
            const col2X = 300;
            let infoY = currentY + 30;

            // Left Column - with proper spacing
            doc.fillColor('#374151')
                .font('Helvetica-Bold')
                .fontSize(8)
                .text('Full Name', col1X, infoY);
            doc.fillColor('#111827')
                .font('Helvetica')
                .fontSize(10)
                .text(studentData.name || studentData.fullName || 'N/A', col1X, infoY + 12);
            
            doc.fillColor('#374151')
                .font('Helvetica-Bold')
                .fontSize(8)
                .text('Email', col1X, infoY + 30);
            doc.fillColor('#111827')
                .font('Helvetica')
                .fontSize(9)
                .text(studentData.email || 'N/A', col1X, infoY + 42, { width: 230 });

            doc.fillColor('#374151')
                .font('Helvetica-Bold')
                .fontSize(8)
                .text('Courses', col1X, infoY + 60);
            doc.fillColor('#111827')
                .font('Helvetica')
                .fontSize(10)
                .text(studentData.course || 'N/A', col1X, infoY + 72);

            // Right Column - with proper spacing
            doc.fillColor('#374151')
                .font('Helvetica-Bold')
                .fontSize(8)
                .text('Mobile', col2X, infoY);
            doc.fillColor('#111827')
                .font('Helvetica')
                .fontSize(10)
                .text(studentData.phone || 'N/A', col2X, infoY + 12);

            doc.fillColor('#374151')
                .font('Helvetica-Bold')
                .fontSize(8)
                .text('Student ID', col2X, infoY + 30);
            doc.fillColor('#111827')
                .font('Helvetica')
                .fontSize(10)
                .text(studentData.studentId || `STU-2026-${registrationId.slice(-4)}`, col2X, infoY + 42);

            doc.fillColor('#374151')
                .font('Helvetica-Bold')
                .fontSize(8)
                .text('Country', col2X, infoY + 60);
            doc.fillColor('#111827')
                .font('Helvetica')
                .fontSize(10)
                .text(studentData.country || 'UK', col2X, infoY + 72);

            // SERVICES SECTION
            currentY = 235;
            doc.fillColor('#111827')
                .font('Helvetica-Bold')
                .fontSize(12)
                .text('SERVICES ENROLLED', 40, currentY);

            currentY += 20;
            doc.rect(40, currentY, doc.page.width - 80, 18)
                .fill('#1e3a8a');
            
            doc.fillColor('white')
                .font('Helvetica-Bold')
                .fontSize(9)
                .text('Service', 50, currentY + 5);
            doc.fillColor('white')
                .font('Helvetica-Bold')
                .fontSize(9)
                .text('Status', doc.page.width - 90, currentY + 5);

            const services = [
                { name: 'Admission & Application Assistance', status: 'Active' },
                { name: 'Visa Guidance & Documentation', status: 'Active' },
                { name: 'Pre-departure Orientation', status: 'Active' }
            ];

            if (studentData.loanOpted) {
                services.push({ name: 'Education Loan Assistance', status: 'Active' });
            }

            currentY += 18;
            services.forEach((service, index) => {
                doc.rect(40, currentY, doc.page.width - 80, 18)
                    .fill(index % 2 === 0 ? '#ffffff' : '#f9fafb')
                    .stroke('#e5e7eb');
                
                doc.fillColor('#111827')
                    .font('Helvetica')
                    .fontSize(9)
                    .text(service.name, 50, currentY + 5);
                
                doc.fillColor('#059669')
                    .font('Helvetica-Bold')
                    .fontSize(9)
                    .text(service.status, doc.page.width - 90, currentY + 5);
                
                currentY += 18;
            });

            // PAYMENT SUMMARY - FIXED
            currentY += 18;
            doc.fillColor('#111827')
                .font('Helvetica-Bold')
                .fontSize(12)
                .text('PAYMENT SUMMARY', 40, currentY);

            currentY += 20;
            doc.roundedRect(40, currentY, doc.page.width - 80, 85, 5)
                .fill('#f0f9ff')
                .stroke('#0ea5e9');

            const totalAmount = parseFloat(studentData.totalAmount) || 0;
            const paidAmount = parseFloat(studentData.paidAmount) || 0;
            const balance = totalAmount - paidAmount;

            // Total Registration Fee
            currentY += 15;
            doc.fillColor('#0c4a6e')
                .font('Helvetica-Bold')
                .fontSize(10)
                .text('Total Registration Fee:', 50, currentY);
            
            doc.fillColor('#111827')
                .font('Helvetica-Bold')
                .fontSize(12)
                .text(formatCurrencyINR(totalAmount), doc.page.width - 150, currentY);

            // Amount Paid
            currentY += 22;
            doc.fillColor('#0c4a6e')
                .font('Helvetica-Bold')
                .fontSize(10)
                .text('Amount Paid:', 50, currentY);
            
            doc.fillColor('#059669')
                .font('Helvetica-Bold')
                .fontSize(12)
                .text(formatCurrencyINR(paidAmount), doc.page.width - 150, currentY);

            // Balance Amount
            currentY += 22;
            doc.fillColor('#0c4a6e')
                .font('Helvetica-Bold')
                .fontSize(10)
                .text('Balance Amount:', 50, currentY);
            
            doc.fillColor(balance > 0 ? '#dc2626' : '#059669')
                .font('Helvetica-Bold')
                .fontSize(12)
                .text(formatCurrencyINR(balance), doc.page.width - 150, currentY);

            // PORTAL ACCESS
            currentY += 38;
            doc.fillColor('#111827')
                .font('Helvetica-Bold')
                .fontSize(12)
                .text('STUDENT PORTAL ACCESS', 40, currentY);

            currentY += 20;
            doc.roundedRect(40, currentY, doc.page.width - 80, 65, 5)
                .fill('#f0fdf4')
                .stroke('#10b981');

            currentY += 12;
            doc.fillColor('#065f46')
                .font('Helvetica-Bold')
                .fontSize(10)
                .text('Your Login Credentials', 50, currentY);

            currentY += 18;
            doc.fillColor('#374151')
                .font('Helvetica')
                .fontSize(8)
                .text('Username:', 50, currentY);
            doc.fillColor('#111827')
                .font('Helvetica-Bold')
                .fontSize(9)
                .text(studentData.email || 'N/A', 120, currentY);

            currentY += 14;
            doc.fillColor('#374151')
                .font('Helvetica')
                .fontSize(8)
                .text('Password:', 50, currentY);
            doc.fillColor('#dc2626')
                .font('Helvetica-Bold')
                .fontSize(9)
                .text(studentData.password || 'mood@jvstudent123', 120, currentY);

            currentY += 16;
            doc.fillColor('#dc2626')
                .font('Helvetica')
                .fontSize(7)
                .text('⚠ Change password after first login', 50, currentY);

            // DISCLAIMER
            currentY += 34;
            doc.roundedRect(40, currentY, doc.page.width - 80, 48, 5)
                .fill('#fef2f2')
                .stroke('#f87171');

            currentY += 10;
            doc.fillColor('#991b1b')
                .font('Helvetica-Bold')
                .fontSize(9)
                .text('IMPORTANT DISCLAIMER', 50, currentY);

            currentY += 10;
            doc.fillColor('#7f1d1d')
                .font('Helvetica')
                .fontSize(7)
                .text('This document confirms your registration with JV Overseas for counselling and processing services. It is not an offer letter from any university.', 50, currentY, { 
                    width: doc.page.width - 100,
                    lineGap: 2
                });
            

            currentY += 10;
            doc.fillColor('#7f1d1d')
                .font('Helvetica')
                .fontSize(7)
                .text('All admissions are subject to the respective university\'s eligibility criteria.', 50, currentY, { 
                    width: doc.page.width - 100 
                });

            currentY += 10;
            doc.fillColor('#7f1d1d')
                .font('Helvetica')
                .fontSize(7)
                .text('Education loans are facilitated by our partner Veda Loans & Finance through multiple lending partners.', 50, currentY, { 
                    width: doc.page.width - 100,
                    lineGap: 2
                });
            

            // FOOTER
            const footerY = doc.page.height - 45;
            doc.moveTo(40, footerY - 10)
                .lineTo(doc.page.width - 40, footerY - 10)
                .stroke('#d1d5db');

            doc.fillColor('#6b7280')
                .font('Helvetica')
                .fontSize(7)
                .text(`JV Overseas | jvoverseaspvtltd@gmail.com | +91 8712275590 | Doc ID: ${registrationId} | ${new Date().toLocaleDateString('en-IN')}`, 40, footerY, { align: 'center', width: doc.page.width - 80 });

            doc.end();

        } catch (err) {
            logger.error(`Error generating PDF: ${err.message}`);
            reject(err);
        }
    });
};

module.exports = {
    generateRegistrationPDF,
    formatCurrencyINR
};