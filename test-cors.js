// Test CORS from browser console
// Copy and paste this into your browser console at https://jv-overseas-pvt-ltd-goz3.vercel.app

fetch('https://jv-backend-core-production.up.railway.app/api/admin/gate', {
    method: 'OPTIONS',
    headers: {
        'Origin': 'https://jv-overseas-pvt-ltd-goz3.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization'
    }
})
    .then(response => {
        console.log('✅ CORS Test Response:');
        console.log('Status:', response.status);
        console.log('Headers:');
        response.headers.forEach((value, key) => {
            if (key.toLowerCase().includes('access-control')) {
                console.log(`  ${key}: ${value}`);
            }
        });
        return response;
    })
    .catch(error => {
        console.error('❌ CORS Test Failed:', error);
    });
