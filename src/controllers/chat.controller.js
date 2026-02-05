const supabase = require('../config/supabaseClient');
const logger = require('../utils/logger');

// @route   POST api/chat/send
// @desc    Send a message to department chat
exports.sendMessage = async (req, res) => {
    const { content, department_id, attachment_url } = req.body;

    // Detailed logging for debugging 500 error
    logger.info(`[CHAT] Attempting to send message. User: ${JSON.stringify(req.user)}, Body: ${JSON.stringify(req.body)}`);

    if (!content && !attachment_url) {
        return res.status(400).json({ msg: 'Message content or attachment required' });
    }

    try {
        if (!req.user || !req.user.id) {
            logger.error('[CHAT] req.user or req.user.id is missing');
            return res.status(401).json({ msg: 'Unauthorized: User ID missing' });
        }

        const { data, error } = await supabase
            .from('team_messages')
            .insert([
                {
                    content,
                    department_id: department_id || req.user.department_id,
                    sender_id: req.user.id,
                    attachment_url
                }
            ])
            .select(`
                *,
                sender:employees(id, name, profile_photo_url)
            `)
            .single();

        if (error) {
            logger.error(`[CHAT] Supabase Insert Error: ${JSON.stringify(error)}`);
            throw error;
        }

        // Normalize response so frontend sees a clean sender object
        const normalizedData = {
            ...data,
            sender: Array.isArray(data.sender) ? data.sender[0] : data.sender
        };

        res.json(normalizedData);
    } catch (err) {
        logger.error(`Send Message Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/chat/:deptId
// @desc    Get chat history for a department
exports.getMessages = async (req, res) => {
    const { deptId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    try {
        const { data, error } = await supabase
            .from('team_messages')
            .select(`
                *,
                sender:employees(id, name, profile_photo_url)
            `)
            .eq('department_id', deptId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Normalize sender objects for all messages
        const normalizedMessages = data.map(msg => ({
            ...msg,
            sender: Array.isArray(msg.sender) ? msg.sender[0] : msg.sender
        }));

        res.json(normalizedMessages.reverse()); // Return in chronological order
    } catch (err) {
        logger.error(`Get Messages Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   DELETE api/chat/:messageId
// @desc    Delete a message (Author only)
exports.deleteMessage = async (req, res) => {
    const { messageId } = req.params;

    try {
        const { error } = await supabase
            .from('team_messages')
            .delete()
            .eq('id', messageId)
            .eq('sender_id', req.user.id);

        if (error) throw error;

        res.json({ msg: 'Message deleted' });
    } catch (err) {
        logger.error(`Delete Message Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// ==========================================
// DIRECT MESSAGING (1-to-1)
// ==========================================

// @route   GET api/chat/conversations
// @desc    Get all conversations for the user
exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch conversations where user is either participant_one or participant_two
        const { data, error } = await supabase
            .from('conversations')
            .select(`
                *,
                p1:employees!participant_one(id, name, profile_photo_url),
                p2:employees!participant_two(id, name, profile_photo_url)
            `)
            .or(`participant_one.eq.${userId},participant_two.eq.${userId}`)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        // Clean up participants to show "the other person"
        const formatted = data.map(conv => {
            const otherUser = conv.participant_one === userId ? conv.p2 : conv.p1;
            return {
                id: conv.id,
                otherUser,
                last_message: conv.last_message,
                last_message_at: conv.last_message_at,
                updated_at: conv.updated_at
            };
        });

        res.json(formatted);
    } catch (err) {
        logger.error(`Get Conversations Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   GET api/chat/direct/:conversationId
// @desc    Get direct messages for a conversation
exports.getDirectMessages = async (req, res) => {
    const { conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    try {
        const { data, error } = await supabase
            .from('direct_messages')
            .select(`
                *,
                sender:employees(id, name, profile_photo_url)
            `)
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json(data.reverse());
    } catch (err) {
        logger.error(`Get Direct Messages Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};

// @route   POST api/chat/direct/send
// @desc    Send a direct message
exports.sendDirectMessage = async (req, res) => {
    const { receiver_id, content, attachment_url } = req.body;
    const sender_id = req.user.id;

    if (!content && !attachment_url) {
        return res.status(400).json({ msg: 'Content or attachment required' });
    }

    try {
        // 1. Find or Create Conversation
        // Ensure participants are always sorted to maintain unique constraint (p1 < p2)
        const participants = [sender_id, receiver_id].sort();

        let { data: conv, error: convError } = await supabase
            .from('conversations')
            .select('id')
            .eq('participant_one', participants[0])
            .eq('participant_two', participants[1])
            .maybeSingle();

        if (convError) throw convError;

        if (!conv) {
            const { data: newConv, error: createError } = await supabase
                .from('conversations')
                .insert({
                    participant_one: participants[0],
                    participant_two: participants[1],
                    last_message: content.substring(0, 100),
                    last_message_at: new Date()
                })
                .select()
                .single();

            if (createError) throw createError;
            conv = newConv;
        }

        // 2. Insert Message
        const { data: message, error: msgError } = await supabase
            .from('direct_messages')
            .insert({
                conversation_id: conv.id,
                sender_id,
                receiver_id,
                content,
                attachment_url
            })
            .select(`
                *,
                sender:employees(id, name, profile_photo_url)
            `)
            .single();

        if (msgError) throw msgError;

        // 3. Update Conversation Last Message
        await supabase
            .from('conversations')
            .update({
                last_message: content.substring(0, 100),
                last_message_at: new Date(),
                updated_at: new Date()
            })
            .eq('id', conv.id);

        res.json(message);
    } catch (err) {
        logger.error(`Send Direct Message Error: ${err.message}`);
        res.status(500).send('Server Error');
    }
};
