// index.js
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';
import { exec } from 'child_process';
import path from 'path'; 
import { fileURLToPath } from 'url'; 
import cron from 'node-cron'; 
import { findSleepSpot, blockCalendarSpot, removeCalendarSpot } from './calendar.js';

const __filename = fileURLToPath(import.meta.url); 
const __dirname = path.dirname(__filename); 

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

const telemetryLog = [];
// ⚡ PHASE 3: The Breach Ledger ⚡
let breachCount = 0; 

let activeSession = {
    warningTimer: null,
    lockTimer: null,
    wakeTimer: null,
    eventId: null,
    // Used for tracking Split-Shifts
    secondaryWarningTimer: null,
    secondaryLockTimer: null,
    secondaryWakeTimer: null,
    secondaryEventId: null
};

let mobilePushToken = null;

// TIMEZONE OVERRIDE CONFIGURATION
const timeZoneConfig = { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' };

app.get('/api/config', (req, res) => {
    const mode = process.env.DISTURB_LICENSE_MODE || 'SOLO';
    console.log(`[DISTURB] Mobile app requested config. Serving mode: ${mode}`);
    res.status(200).json({ status: 'success', licenseMode: mode });
});

app.post('/api/register-device', (req, res) => {
    mobilePushToken = req.body.token;
    console.log(`[DISTURB] Mobile device registered for remote push commands. Token secured.`);
    res.status(200).json({ status: 'success' });
});

// ⚡ THE 8:00 AM AUTONOMOUS SCANNER (UPGRADED FOR PACIFIC TIME) ⚡
cron.schedule('0 8 * * *', async () => {
    console.log('[DISTURB] ⏰ Executing 8:00 AM Autonomous Scan...');
    try {
        const cronMinutes = parseInt(process.env.CRON_TARGET_MINUTES) || 30;
        const cronDeadline = parseInt(process.env.CRON_DEADLINE_HOUR) || 17;

        const spotData = await findSleepSpot(cronMinutes, 'strict', cronDeadline); 
        
        if (spotData && mobilePushToken) {
            let notificationTitle = '⚡ DISTURB: TARGET ACQUIRED';
            let notificationBody = '';

            if (spotData.status === 'IDEAL') {
                const startStr = spotData.start.toLocaleTimeString('en-US', timeZoneConfig);
                const endStr = spotData.end.toLocaleTimeString('en-US', timeZoneConfig);
                notificationBody = `Optimal ${spotData.minutes}m recovery block secured: ${startStr} - ${endStr}. Tap to arm system.`;
            } 
            else if (spotData.status === 'NEGOTIATED') {
                const startStr = spotData.start.toLocaleTimeString('en-US', timeZoneConfig);
                const endStr = spotData.end.toLocaleTimeString('en-US', timeZoneConfig);
                notificationBody = `${spotData.originalTarget}m target unavailable. Secured ${spotData.minutes}m compromise: ${startStr} - ${endStr}. Accept deal?`;
            }
            else if (spotData.status === 'SPLIT') {
                const s1 = spotData.spots[0].start.toLocaleTimeString('en-US', timeZoneConfig);
                const s2 = spotData.spots[1].start.toLocaleTimeString('en-US', timeZoneConfig);
                notificationBody = `Continuous block impossible. Secured two ${spotData.spots[0].minutes}m micro-recoveries at ${s1} & ${s2}. Arm matrix?`;
            }
            else if (spotData.status === 'BREACH') {
                notificationTitle = '⚠️ DISTURB: BURNOUT BREACH';
                notificationBody = `Optimal recovery window unavailable due to severe schedule density. Burnout Breach logged. Conserve your energy today—your calendar is at maximum capacity.`;
                breachCount++; 
                console.log(`[DISTURB] 🔴 BURNOUT BREACH LOGGED. Total Breaches: ${breachCount}`);
            }

            await axios.post('https://exp.host/--/api/v2/push/send', {
                to: mobilePushToken,
                title: notificationTitle,
                body: notificationBody,
                sound: 'default',
                priority: 'high'
            });
            console.log(`[DISTURB] Morning push deployed via matrix logic. Status: ${spotData.status}`);
        }
    } catch (error) {
        console.error('[DISTURB] Cron Execution Failed:', error.message);
    }
}, {
    scheduled: true,
    timezone: "America/Los_Angeles"
});

// ⚡ MANUAL SCANNER API (UPGRADED FOR THE MATRIX) ⚡
app.get('/api/scan-calendar', async (req, res) => {
    const mode = req.query.mode || 'strict';
    const targetMinutes = parseInt(req.query.minutes) || 30;
    const deadline = parseInt(req.query.deadline) || 17;

    try {
        console.log(`[DISTURB] Commencing scan for ${targetMinutes}m before hour ${deadline}...`);
        const spotData = await findSleepSpot(targetMinutes, mode, deadline); 
        
        if (spotData.status === 'BREACH') {
            breachCount++;
            console.log(`[DISTURB] 🔴 BURNOUT BREACH LOGGED. Total Breaches: ${breachCount}`);
            res.status(200).json({ status: 'success', found: false, message: 'BURNOUT BREACH: MAXIMUM CALENDAR CAPACITY.' });
        } else {
            console.log(`[DISTURB] Gap Matrix Status: ${spotData.status}`);
            res.status(200).json({ status: 'success', found: true, data: spotData });
        }
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

app.post('/api/arm-recovery', async (req, res) => {
    const { startISO, endISO, minutes } = req.body;
    
    try {
        console.log(`[DISTURB] System Armed. Defending calendar for ${minutes} MIN block...`);
        
        const eventData = await blockCalendarSpot(startISO, endISO);
        activeSession.eventId = eventData.id;

        const startTime = new Date(startISO).getTime();
        const endTime = new Date(endISO).getTime();
        const now = Date.now();

        clearTimeout(activeSession.warningTimer);
        clearTimeout(activeSession.lockTimer);
        clearTimeout(activeSession.wakeTimer);

        const warningTime = startTime - (5 * 60 * 1000);
        if (warningTime > now) {
            activeSession.warningTimer = setTimeout(() => {
                console.log('[DISTURB] Firing 5-minute wrap-up warning to desktop.');
                exec(`osascript -e 'display notification "Cognitive recovery block initiates in 5 minutes. Wrap up your current task." with title "DISTURB"'`);
            }, warningTime - now);
        }

        const lockdownDelay = startTime - now;
        if (lockdownDelay > 0) {
            activeSession.lockTimer = setTimeout(async () => {
                console.log('[DISTURB] Executing Scheduled Lockdown...');
                try {
                    await axios.post('https://slack.com/api/dnd.setSnooze', new URLSearchParams({ token: process.env.SLACK_USER_TOKEN, num_minutes: minutes }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                    // LOCALIZED PACIFIC TIME INJECTION
                    const returnTime = new Date(endTime).toLocaleTimeString('en-US', timeZoneConfig);
                    await axios.post('https://slack.com/api/users.profile.set', { profile: { status_text: `⚡ System Locked / Back at ${returnTime}`, status_emoji: ":disturb-blue:", status_expiration: 0 } }, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${process.env.SLACK_USER_TOKEN}` } });
                    exec('shortcuts run "DisturbOn"', () => console.log('[DISTURB] Mac OS DND Engaged.'));
                    telemetryLog.push({ id: Date.now().toString(), user: "Babatunde", action: "LOCKED", durationRequested: minutes, timestamp: new Date().toISOString() });
                } catch (error) { console.error('[DISTURB] Scheduled Lockdown Failed:', error.message); }
            }, lockdownDelay);
        }

        const wakeDelay = endTime - now;
        if (wakeDelay > 0) {
            activeSession.wakeTimer = setTimeout(async () => {
                console.log('[DISTURB] Executing Scheduled Wake Sequence...');
                try {
                    await axios.post('https://slack.com/api/dnd.endDnd', new URLSearchParams({ token: process.env.SLACK_USER_TOKEN }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                    await axios.post('https://slack.com/api/users.profile.set', { profile: { status_text: "", status_emoji: "" } }, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${process.env.SLACK_USER_TOKEN}` } });
                    exec('shortcuts run "DisturbOff"', () => console.log('[DISTURB] Mac OS DND Cleared.'));
                    telemetryLog.push({ id: Date.now().toString(), user: "Babatunde", action: "AWAKE", timestamp: new Date().toISOString() });
                } catch (error) { console.error('[DISTURB] Scheduled Wake Failed:', error.message); }
            }, wakeDelay);
        }

        res.status(200).json({ status: 'success', message: 'System Armed.' });
    } catch (error) {
        res.status(500).json({ status: 'fatal', error: error.message });
    }
});

app.post('/api/clear-recovery', async (req, res) => {
    try {
        console.log('[DISTURB] ABORT PROTOCOL INITIATED. Killing active timers...');
        
        clearTimeout(activeSession.warningTimer);
        clearTimeout(activeSession.lockTimer);
        clearTimeout(activeSession.wakeTimer);

        if (activeSession.eventId) {
            await removeCalendarSpot(activeSession.eventId);
            activeSession.eventId = null;
        }

        await axios.post('https://slack.com/api/dnd.endDnd', new URLSearchParams({ token: process.env.SLACK_USER_TOKEN }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        await axios.post('https://slack.com/api/users.profile.set', { profile: { status_text: "", status_emoji: "" } }, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${process.env.SLACK_USER_TOKEN}` } });
        exec('shortcuts run "DisturbOff"');
        
        console.log('[DISTURB] System successfully disarmed.');
        res.status(200).json({ status: 'success', message: 'System aborted and restored.' });
    } catch (error) {
        res.status(500).json({ status: 'fatal', error: error.message });
    }
});

// ⚡ DASHBOARD API: NOW EXPOSING THE BREACH LEDGER ⚡
app.get('/api/dashboard', (req, res) => {
    const totalSessions = telemetryLog.filter(log => log.action === 'LOCKED').length;
    const totalMinutesProtected = telemetryLog.filter(log => log.action === 'LOCKED').reduce((sum, log) => sum + log.durationRequested, 0);
    res.status(200).json({ 
        company: "Disturb Enterprise Client", 
        metrics: { 
            activeUsers: 1, 
            totalLockdownsExecuted: totalSessions, 
            totalMinutesProtected: totalMinutesProtected,
            burnoutBreachesLogged: breachCount // 🔴 Exposed to HR
        }, 
        rawLogs: telemetryLog 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[DISTURB] Command Center live on port ${PORT}`));