// auth.js
import fs from 'fs/promises';
import { google } from 'googleapis';
import http from 'http';
import url from 'url';

// ⚡ MASTER SCOPES: GRANTS READ (RADAR) AND WRITE (DEFENSE) AUTHORITY ⚡
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events'
];

async function authenticate() {
    try {
        const credsContent = await fs.readFile('credentials.json', 'utf-8');
        const keys = JSON.parse(credsContent);
        const { client_secret, client_id } = keys.installed || keys.web;
        
        const oAuth2Client = new google.auth.OAuth2(
            client_id,
            client_secret,
            'http://localhost:3000/oauth2callback'
        );

        const authorizeUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent' 
        });

        console.log("\n=============================================");
        console.log("⚡ [DISTURB] CALENDAR MASTER UPGRADE REQUIRED ⚡");
        console.log("=============================================");
        console.log("1. Click this link to authorize the app to read AND write to your calendar:\n");
        console.log(authorizeUrl);
        console.log("\n2. Waiting for your approval in the browser...\n");

        const server = http.createServer(async (req, res) => {
            if (req.url.startsWith('/oauth2callback')) {
                const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
                const code = qs.get('code');

                res.end('Authentication successful! You can close this tab and return to your terminal.');
                
                const { tokens } = await oAuth2Client.getToken(code);
                await fs.writeFile('token.json', JSON.stringify(tokens));

                console.log("\n[DISTURB] Access Granted.");
                console.log("[DISTURB] New Master Token generated successfully. The system can now scan and defend.");
                
                server.close(() => {
                    process.exit(0);
                });
            }
        }).listen(3000);
        
    } catch (error) {
        console.error('[DISTURB] Authentication Failed:', error.message);
    }
}

authenticate();