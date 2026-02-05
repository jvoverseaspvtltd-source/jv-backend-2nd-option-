const supabase = require('../config/supabaseClient');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const emailService = require('../services/email.service');
const chatbotConfig = require('../config/chatbotConfig');
const validationService = require('../services/validation.service');
const leadService = require('../services/lead.service');

// @route   POST api/public/intake
// @desc    Submit new lead from website form
// @access  Public
exports.intake = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, phone, email, serviceType, details } = req.body;

    try {
        const university = details?.university;
        const preferredCountry = details?.preferredCountry || details?.country;

        logger.info(`Processing new enquiry from ${email} - Type: ${serviceType}`);

        // Insert into Supabase
        const { data, error } = await supabase
            .from('leads')
            .insert([
                {
                    name,
                    phone,
                    email: validationService.normalizeEmail(email),
                    service_type: serviceType,
                    source: 'website',
                    status: 'ENQUIRY_RECEIVED',
                    details, // JSONB
                    university,
                    preferred_country: preferredCountry
                }
            ])
            .select()
            .single();

        if (error) throw error;

        const lead = data;

        // AUTO ASSIGNMENT
        // Fire and forget (don't wait for response to speed up UI)
        leadService.assignLead(lead.id).catch(err => logger.error(`Auto-assign failed: ${err.message}`));

        logger.info(`✅ Lead successfully saved to database - ID: ${lead.id}, Email: ${email}, University: ${university || 'N/A'}`);

        // Send Email
        let enquiryType = serviceType || 'General Enquiry';
        const emailDetails = {};
        if (university) emailDetails.university = university;
        if (preferredCountry) emailDetails.preferredCountry = preferredCountry;
        if (details?.course) emailDetails.course = details.course;
        if (details?.intakeMonth && details?.intakeYear) {
            emailDetails.intake = `${details.intakeMonth} ${details.intakeYear}`;
        }

        try {
            await emailService.sendProfessionalEnquiryConfirmation(email, name, enquiryType, emailDetails);
            logger.info(`✅ Confirmation email sent to ${email}`);
        } catch (emailErr) {
            logger.error(`❌ Email failed for ${email}: ${emailErr.message}`);
        }

        res.json({
            success: true,
            message: 'Enquiry submitted successfully',
            leadId: lead.id,
            data: lead
        });
    } catch (err) {
        logger.error(`❌ DATABASE SAVE FAILED for ${email}: ${err.message}`);
        res.status(500).json({
            success: false,
            message: 'Failed to save enquiry.',
            error: process.env.NODE_ENV === 'development' ? err.message : 'Server error'
        });
    }
};

// @route   POST api/public/comprehensive-eligibility
exports.comprehensiveEligibility = async (req, res) => {
    const { studentDetails = {}, academics = {}, courseDetails = {}, testScores = {}, loanRequirement = {}, coApplicant = {}, collateral = {}, additionalInfo = {} } = req.body;
    const { emailId, fullName, mobileNumber } = studentDetails;

    if (!emailId || !fullName || !mobileNumber) {
        return res.status(400).json({ message: 'Student details (name, email, phone) are required' });
    }

    try {
        // 1. Find or Create Lead
        let { data: lead, error: findError } = await supabase
            .from('leads')
            .select('*')
            .eq('email', emailId)
            .single();

        const fullDetails = {
            studentDetails, academics, courseDetails, testScores,
            loanRequirement, coApplicant, collateral, additionalInfo
        };

        if (!lead || findError) {
            const { data: newLead, error: createError } = await supabase
                .from('leads')
                .insert([{
                    name: fullName,
                    phone: mobileNumber,
                    email: validationService.normalizeEmail(emailId),
                    service_type: 'Loan',
                    source: 'eligibility',
                    status: 'ENQUIRY_RECEIVED',
                    details: fullDetails // Store all data
                }])
                .select()
                .single();

            if (createError) throw createError;
            lead = newLead;

            // AUTO ASSIGNMENT
            leadService.assignLead(lead.id).catch(err => logger.error(`Auto-assign failed: ${err.message}`));
        } else {
            // Update existing lead with full details
            const { data: updatedLead, error: updateError } = await supabase
                .from('leads')
                .update({
                    details: { ...(lead.details || {}), ...fullDetails },
                    updated_at: new Date().toISOString()
                })
                .eq('id', lead.id)
                .select()
                .single();

            if (!updateError) lead = updatedLead;
        }

        // 2. Pre-screening Logic & Analysis
        let isEligible = false;
        let recommendedLoanType = loanRequirement.preferredType || "Unsecured";
        let suggestedBanks = ["Punjab National Bank (PNB)", "Avanse", "Credila", "Auxilo", "InCred", "Tata Capital", "Prodigy Finance"];

        // Qualification criteria: Stable income + Docs OR Collateral
        const hasCoApp = coApplicant.hasCoApplicant === 'Yes';
        const hasIncome = coApplicant.hasStableIncome === 'Yes' && coApplicant.incomeDocsAvailable === 'Yes';
        const hasProperty = collateral.hasCollateral === 'Yes';

        if ((hasCoApp && hasIncome) || hasProperty) {
            isEligible = true;
        }

        // 3. Create Eligibility Record (JSONB storage handles the new schema naturally)
        const { error: recordError } = await supabase
            .from('eligibility_records')
            .insert([{
                lead_id: lead.id,
                student_details: studentDetails,
                academics,
                course_details: courseDetails,
                test_scores: testScores,
                loan_requirement: loanRequirement,
                co_applicant: coApplicant,
                collateral: collateral,
                additional_info: additionalInfo,
                analysis: {
                    isEligible,
                    preScreeningStatus: isEligible ? 'QUALIFIED' : 'REVIEW_NEEDED',
                    recommendedLoanType,
                    suggestedBanks: isEligible ? suggestedBanks : [],
                    status: 'PENDING',
                    remarks: "Pre-screening based on document availability and co-applicant status."
                }
            }]);

        if (recordError) throw recordError;

        // 4. Send Email
        try {
            await emailService.sendEligibilityConfirmation(
                emailId,
                fullName,
                isEligible,
                isEligible ? "High (Based on Profile)" : "Pending Review"
            );
        } catch (e) { logger.error(`Email failed: ${e.message}`); }

        res.json({
            success: true,
            isEligible,
            recommendedLoanType,
            suggestedBanks: isEligible ? suggestedBanks : [],
            message: isEligible
                ? `Great news! Based on your profile and document availability, you are qualified for an initial loan review. Our expert will contact you to discuss specific amounts.`
                : "Thank you for sharing your details. Our advisor will review your profile and contact you shortly."
        });

    } catch (err) {
        logger.error(`Error in comprehensive eligibility: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/public/eligibility-check (Simple)
exports.checkEligibility = async (req, res) => {
    const { name, phone, email, hasStableIncome, serviceType } = req.body;

    try {
        // Find or Create Lead
        let { data: lead, error: findError } = await supabase
            .from('leads')
            .select('*')
            .eq('email', email)
            .single();

        if (!lead || findError) {
            const { data: newLead, error: createError } = await supabase
                .from('leads')
                .insert([{
                    name,
                    phone,
                    email: validationService.normalizeEmail(email),
                    service_type: serviceType || 'Loan',
                    source: 'eligibility_simple',
                    status: 'ENQUIRY_RECEIVED',
                    details: { fullName: name, mobileNumber: phone, emailId: email }
                }])
                .select()
                .single();
            if (createError) throw createError;
            lead = newLead;

            // AUTO ASSIGNMENT
            leadService.assignLead(lead.id).catch(err => logger.error(`Auto-assign failed: ${err.message}`));
        }

        let isEligible = (hasStableIncome === 'Yes' || hasStableIncome === true);

        await supabase.from('eligibility_records').insert([{
            lead_id: lead.id,
            student_details: { fullName: name, mobileNumber: phone, emailId: email },
            analysis: {
                isEligible,
                preScreening: true,
                status: 'PENDING'
            }
        }]);

        try {
            await emailService.sendEligibilityConfirmation(email, name, isEligible, "Profile-based");
        } catch (e) { }

        if (isEligible) {
            res.json({ eligible: true, message: "Based on your initial profile, you are qualified for an expert consultation." });
        } else {
            res.json({ eligible: false, message: "We need more info to determine your eligibility. Our agent will contact you." });
        }
    } catch (err) {
        logger.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/public/chat-message
exports.chatMessage = async (req, res) => {
    const { name, phone, email, message } = req.body;
    try {
        await supabase.from('leads').insert([{
            name,
            phone,
            email: validationService.normalizeEmail(email),
            service_type: 'General Inquiry',
            source: 'chat',
            details: { initialMessage: message }
        }]);
        res.json({ msg: 'Message received.' });
    } catch (err) {
        logger.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/public/chat-conversation
exports.chatConversation = async (req, res) => {
    const { message } = req.body;
    try {
        if (!message) return res.status(400).json({ reply: "I'm listening!" });

        const lowerMsg = message.toLowerCase();
        let bestMatch = null;
        let maxScore = 0;

        for (const entry of chatbotConfig.knowledgeBase) {
            let currentScore = 0;
            for (const pattern of entry.patterns) {
                if (lowerMsg.includes(pattern.toLowerCase())) currentScore += 3;
                pattern.split(' ').forEach(word => {
                    if (new RegExp(`\\b${word.toLowerCase()}\\b`, 'i').test(lowerMsg)) currentScore += 1;
                });
            }
            if (currentScore > maxScore) {
                maxScore = currentScore;
                bestMatch = entry;
            }
        }

        let reply = chatbotConfig.fallbackResponse;
        let suggestions = [];

        if (maxScore > 0) {
            reply = Array.isArray(bestMatch.response)
                ? bestMatch.response[Math.floor(Math.random() * bestMatch.response.length)]
                : bestMatch.response;
            suggestions = bestMatch.suggestions || [];
        }

        res.json({ reply, matchFound: maxScore > 0, suggestions });
    } catch (err) {
        logger.error(`Chatbot Error: ${err.message}`);
        res.status(500).json({ reply: "I hit a small roadblock.", suggestions: [] });
    }
};

exports.getContent = (req, res) => {
    res.json({ heroTitle: "Welcome to Our Services", news: [] });
};
