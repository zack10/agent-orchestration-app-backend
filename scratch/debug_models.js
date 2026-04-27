const https = require('https');
const fs = require('fs');
const path = require('path');

// Manually parse .env.local because of powershell issues
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/GEMINI_API_KEY\s*=\s*(.*)/);
const key = match ? match[1].trim() : null;

if (!key) {
    console.error('Could not find GEMINI_API_KEY in .env.local');
    process.exit(1);
}

console.log('Testing API key starting with:', key.substring(0, 5) + '...');

https.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, (res) => {
    let data = '';
    res.on('data', (d) => data += d);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.models) {
                console.log('\n✅ Connection Successful!');
                console.log('Available models for your key:');
                json.models.forEach(m => {
                    if (m.name.includes('gemini')) {
                        console.log('- ' + m.name.replace('models/', ''));
                    }
                });
            } else {
                console.log('\n❌ API returned an error:');
                console.log(JSON.stringify(json, null, 2));
            }
        } catch (e) {
            console.log('Could not parse response:', data);
        }
    });
}).on('error', (e) => {
    console.error('Connection Error:', e.message);
});
