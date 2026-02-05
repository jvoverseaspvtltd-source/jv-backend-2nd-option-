const chatbotConfig = {
    companyName: "JV Overseas Pvt. Ltd.",

    // Default Fallback
    fallbackResponse: "I'm still learning to master all the details! I can give you expert advice on: 🎓 Admissions, 📄 Visas, 💰 Loans, or 📝 Profile Evaluation. Which one should we start with?",

    knowledgeBase: [
        {
            label: "Greetings",
            patterns: ["hi", "hello", "hey", "namaste", "start", "good morning", "good afternoon", "greetings"],
            response: [
                "Hello! Welcome to JV Overseas. How can I help you regarding your study abroad plans today?",
                "Namaste! It's great to have you here. I am your JV Assistant. What's on your mind regarding global education?",
                "Hi there! Ready to start your international journey? I'm here to help you with admissions, loans, and visas."
            ],
            suggestions: ["Tell me about JV Overseas", "Which countries do you assist?"]
        },
        {
            label: "Organization Info",
            patterns: ["organization", "company", "about", "firm", "who are you", "features", "tell me more"],
            response: [
                "JV Overseas Pvt. Ltd. is a specialized consultancy helping students reach top universities across 12+ countries. We handle everything from university shortlisting to secured/unsecured education loans and visa documentation.",
                "We are a premier education consultancy in India, dedicated to helping students secure admissions in top global destinations. We offer end-to-end support for your study abroad journey."
            ],
            suggestions: ["List of countries", "What services do you offer?"]
        },
        {
            label: "Country List",
            patterns: ["countries", "which country", "destinations", "where do you provide", "list of countries"],
            response: "We provide admissions for 12+ countries: USA, UK, Canada, Australia, Germany, Ireland, New Zealand, France, Sweden, Spain, Singapore, and UAE. Each country has different PR rules and costs. Which one would you like to know about?",
            suggestions: ["Tell me about USA", "Tell me about UK", "Canada PR rules"]
        },
        {
            label: "USA Admissions",
            patterns: ["usa", "united states", "america"],
            response: "USA is a top choice for STEM courses. We've helped students like Rahul Singh (GRE 305) secure admits with 25% scholarships by focusing on their overall profile and SOPs.",
            suggestions: ["USA cost of study", "USA visa process"]
        },
        {
            label: "UK Admissions",
            patterns: ["uk", "united kingdom", "london", "manchester"],
            response: "The UK offers 1-year Master's programs. We recently helped Aditya Sharma, who had a 2-year gap after B.Tech, get into the University of Manchester by highlighting his realistic career goals.",
            suggestions: ["UK visa timeline", "Is UK good for gap years?"]
        },
        {
            label: "Canada Admissions",
            patterns: ["canada", "toronto", "ubc", "vancouver"],
            response: "Canada is known for its PR-friendly policies. Sanya Verma (7.5 CGPA) secured Toronto through our guidance, even when others said to aim lower. We offer honest advice on changing PR rules.",
            suggestions: ["Canada PR updates", "Canada cost of study"]
        },
        {
            label: "Australia Admissions",
            patterns: ["australia", "melbourne", "sydney", "monash"],
            response: "Australia is excellent for research and lifestyle. We helped Karthik R. get into Monash and sogar Fatima Z. with Melbourne. Our pre-departure sessions for Australia cover everything from SIM cards to bank accounts.",
            suggestions: ["Australia visa success", "Post-arrival support"]
        },
        {
            label: "Germany Admissions",
            patterns: ["germany", "munich", "public university", "blocked account"],
            response: "Germany is famous for its low/zero tuition public universities. We guided Meera Nair through the complex Blocked Account (Expatrio) process to secure her seat at TU Munich.",
            suggestions: ["Blocked account process", "Germany fee savings"]
        },
        {
            label: "How to Choose Country",
            patterns: ["how to choose", "which university", "right country", "recommendation"],
            response: "Our expert counselors evaluate your academic profile, budget, and career goals to provide data-driven recommendations for the best-fit countries and universities worldwide.",
            suggestions: ["Evaluate my profile", "Budget for study abroad"]
        },
        {
            label: "Total Costs/Fees",
            patterns: ["fee", "cost", "how much", "budget", "expense", "tuition", "investment"],
            response: "The total cost usually ranges from ₹20 Lakhs to ₹50 Lakhs. This includes your tuition fees, living expenses, visa, and insurance. The exact range depends on the country and course level.",
            suggestions: ["Education loans", "Scholarship assistance"]
        },
        {
            label: "Loan Approval Timelines",
            patterns: ["loan time", "loan approval", "how many days for loan", "loan duration"],
            response: "Education loan approval typically takes 7–10 working days for private banks/NBFCs, and 15–25 working days for public sector banks. We assist in expediting this process for our students.",
            suggestions: ["Loan with offer letter", "Partner banks"]
        },
        {
            label: "Loan Process with Offer",
            patterns: ["loan process", "start loan", "loan before visa", "loan with offer"],
            response: "If you receive an admission offer tomorrow, we can immediately start your loan processing using that letter. Many banks can even issue an official sanction letter before you file your visa application.",
            suggestions: ["Visa documentation", "Financial proof"]
        },
        {
            label: "Visa Support",
            patterns: ["visa", "permit", "immigration", "visa process", "documentation", "visa timeline", "visa success rate"],
            response: "Our visa guidance covers everything from financial documentation to mock interview prep. We maintain a 95-100% success rate by ensuring all paperwork aligns perfectly with embassy requirements.",
            suggestions: ["Mock interview prep", "Financial guidance"]
        },
        {
            label: "Success Stories",
            patterns: ["success stories", "testimonials", "reviews", "results", "students placed"],
            response: [
                "We have 5,000+ happy students! From Aditya getting into Manchester with a 2-year gap to Sanya securing Toronto with a 7.5 CGPA, we focus on realistic results.",
                "Our students have reached top campuses like Monash, TU Munich, and Northeastern. We focus on highlighting the strengths of your unique profile."
            ],
            suggestions: ["Aditya's story", "Sanya's story", "Meera's Germany story"]
        },
        {
            label: "Professional Services",
            patterns: ["services", "what do you do", "help", "support", "features"],
            response: "JV Overseas provides comprehensive end-to-end solutions: \n1. Study Abroad Counseling\n2. University & Selection\n3. Education Loan Help\n4. Application Support\n5. Visa Documentation\n6. Test Prep (IELTS, PTE, GRE)\n7. Scholarship Guidance\n8. Post-Arrival Support.",
            suggestions: ["Loan help", "Application support", "Post-arrival support"]
        },
        {
            label: "Post-Arrival Support",
            patterns: ["post arrival", "after landing", "reaching", "settlement", "accommodation", "sim card", "bank account"],
            response: "Our support doesn't end at the airport! We provide pre-departure briefings, assistance with finding accommodation, and guidance on setting up bank accounts and SIM cards in your new country.",
            suggestions: ["International sim card", "Finding accommodation"]
        },
        {
            label: "Test Preparation",
            patterns: ["ielts", "pte", "toefl", "gre", "gmat", "test prep", "exam", "coaching"],
            response: "We offer expert coaching for IELTS, PTE, TOEFL, GRE, and GMAT to help you ace your exams. Our training is designed to meet the requirements of top global universities.",
            suggestions: ["IELTS coaching", "GRE prep"]
        },
        {
            label: "Scholarships",
            patterns: ["scholarship", "merit based", "financial aid", "grant"],
            response: "We help identify and apply for both merit-based and need-based scholarships. Our team has helped students secure up to 25-50% scholarships at top US and UK universities.",
            suggestions: ["Scholarship guidance", "USA scholarships"]
        },
        {
            label: "FAQs & Common Concerns",
            patterns: ["faq", "common questions", "questions", "concerns"],
            response: "Got questions? We've got answers! I can clarify concerns about choosing countries, loan assistance, visa success rates, test prep, or post-arrival support. What's on your mind?",
            suggestions: ["How to choose country?", "Visa success rate?", "Loan assistance?"]
        },
        {
            label: "Stats & Partners",
            patterns: ["how many universities", "partners", "success rate", "students", "stats"],
            response: "JV Overseas has 500+ Partner Universities globally, a 95-100% Visa Success Rate, and has placed over 5,000+ students in top campuses with 24/7 support available.",
            suggestions: ["View all partners", "Student success stories"]
        },
        {
            label: "Contact & Location",
            patterns: ["contact", "call", "email", "whatsapp", "location", "address", "where are you", "office"],
            response: "We are located at Medara Bazar, Chilakaluripet, AP. You can call us at +91 8712275590 or email jvoverseaspvtltd@gmail.com. We're open Mon-Sat, 10 AM-6:30 PM.",
            suggestions: ["Call us", "Visit office"]
        }
    ]
};

module.exports = chatbotConfig;
