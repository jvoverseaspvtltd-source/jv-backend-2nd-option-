const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

// @route   GET api/student/payments/overview
// @desc    Get student payment overview
const getPaymentOverview = async (req, res) => {
    try {
        const { data: student, error } = await supabase
            .from('registrations')
            .select('payment_details, payment_status, status')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        const paymentDetails = student.payment_details || {};
        const totalAmount = parseFloat(paymentDetails.totalAmount) || 0;
        const paidAmount = parseFloat(paymentDetails.paidAmount) || 0;
        const balance = totalAmount - paidAmount;

        res.json({
            totalAmount,
            paidAmount,
            balance,
            paymentStatus: student.payment_status || 'Pending',
            registrationStatus: student.status,
            installmentsCount: (paymentDetails.installments || []).length
        });

    } catch (err) {
        logger.error(`Payment Overview Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/student/payments/history
// @desc    Get student payment history (installments)
const getPaymentHistory = async (req, res) => {
    try {
        const { data: student, error } = await supabase
            .from('registrations')
            .select('payment_details')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        const installments = student.payment_details?.installments || [];

        // Sort by date descending (most recent first)
        const sortedInstallments = installments.sort((a, b) => 
            new Date(b.date) - new Date(a.date)
        );

        res.json({
            payments: sortedInstallments,
            total: installments.length
        });

    } catch (err) {
        logger.error(`Payment History Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/student/payments/access-flags
// @desc    Get feature access flags based on payment status
const getAccessFlags = async (req, res) => {
    try {
        const { data: student, error } = await supabase
            .from('registrations')
            .select('payment_details, payment_status, workflow')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        const paymentDetails = student.payment_details || {};
        const totalAmount = parseFloat(paymentDetails.totalAmount) || 0;
        const paidAmount = parseFloat(paymentDetails.paidAmount) || 0;
        const balance = totalAmount - paidAmount;
        const paymentStatus = student.payment_status || 'Pending';

        // Determine access based on payment
        const isPaidPartially = paidAmount > 0 && balance > 0;
        const isPaidFull = balance <= 0 && totalAmount > 0;
        const hasLoanOpted = student.workflow?.loanOpted || false;

        res.json({
            canAccessDocuments: isPaidPartially || isPaidFull,
            canAccessFullPortal: isPaidFull,
            canApplyForLoan: hasLoanOpted,
            paymentStatus,
            requiresPayment: balance > 0
        });

    } catch (err) {
        logger.error(`Access Flags Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

module.exports = {
    getPaymentOverview,
    getPaymentHistory,
    getAccessFlags
};
