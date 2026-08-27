// index.js
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';
import { exec } from 'child_process';
import path from 'path'; 
import { fileURLToPath } from 'url'; 
import cron from 'node-cron'; 
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import fs from 'fs';
import { findSleepSpot, blockCalendarSpot, removeCalendarSpot } from './calendar.js';

const __filename = fileURLToPath(import.meta.url); 
const __dirname = path.dirname(__filename); 

// ⚡ REALTIME DATABASE INITIATION ⚡
let db;
try {
    // Dynamically check if we are in the Render cloud vault, otherwise use local path
    const keyPath = process.env.RENDER ? '/etc/secrets/firebase-credentials.json' : path.join(__dirname, 'firebase-credentials.json');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    
    initializeApp({
        credential: cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DB_URL
    });
    db = getDatabase();
    console.log('[DISTURB] Realtime Database Matrix: ONLINE');
} catch (error) {
    console.error('[DISTURB] FATAL DB ERROR:', error.message);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

const telemetryLog = [];
let breachCount = 0; 

let activeSession = {
    warningTimer: null,
    lockTimer: null,
    wakeTimer: null,
    eventId: null,
    secondaryWarningTimer: null,
    secondaryLockTimer: null,
    secondaryWakeTimer: null,
    secondaryEventId: null
};

const timeZoneConfig = { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' };

app.get('/api/config', (req, res) => {
    const mode = process.env.DISTURB_LICENSE_MODE || 'SOLO';
    console.log(`[DISTURB] Mobile app requested config. Serving mode: ${mode}`);
    res.status(200).json({ status: 'success', licenseMode: mode });
});

// ⚡ REALTIME DB SYNC: DEVICE REGISTRATION ⚡
app.post('/api/register-device', async (req, res) => {
    const { token } = req.body;
    try {
        if (!db) throw new Error("Database not initialized");
        
        const userRef = db.ref('users/Babatunde');
        
        // 1. Use await snap.get() before updates for Realtime DB sync.
        const snap = await userRef.get();
        let currentData = snap.exists() ? snap.val() : {};

        await userRef.set({
            userId: 'Babatunde',
            pushToken: token,
            cronHour: currentData.cronHour !== undefined ? currentData.cronHour : 8,
            cronMinute: currentData.cronMinute !== undefined ? currentData.cronMinute : 0,
            targetMinutes: currentData.targetMinutes || 30,
            deadlineHour: currentData.deadlineHour || 17,
            lastScanDate: currentData.lastScanDate || ''
        });

        console.log(`[DISTURB] Mobile device registered & Realtime Sync complete for Babatunde.`);
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('[DISTURB] Sync Error:', error.message);
        res.status(500).json({ status: 'error' });
    }
});

// ⚡ THE DYNAMIC CRON ENGINE (RUNS EVERY MINUTE) ⚡
cron.schedule('* * * * *', async () => {
    try {
        if (!db) return;

        const now = new Date();
        const ptTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
        const currentHour = ptTime.getHours();
        const currentMinute = ptTime.getMinutes();
        const currentDateStr = ptTime.toISOString().split('T')[0];

        const usersRef = db.ref('users');
        const snap = await usersRef.get();
        
        if (!snap.exists()) return;

        // 2. Force current_order to Array via Object.values() to prevent Object-crash.
        const usersArray = Object.values(snap.val());

        for (const userData of usersArray) {
            if (userData.cronHour === currentHour && userData.cronMinute === currentMinute) {
                // Prevent duplicate firing on the same day
                if (userData.lastScanDate === currentDateStr) continue;

                console.log(`[DISTURB] ⏰ Executing Dynamic Autonomous Scan for ${userData.userId}...`);
                const spotData = await findSleepSpot(userData.targetMinutes, 'strict', userData.deadlineHour); 
                
                if (spotData && userData.pushToken) {
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
                        to: userData.pushToken,
                        title: notificationTitle,
                        body: notificationBody,
                        sound: 'default',
                        priority: 'high'
                    });

                    console.log(`[DISTURB] Push deployed. Status: ${spotData.status}`);
                    await db.ref(`users/${userData.userId}`).update({ lastScanDate: currentDateStr });
                }
            }
        }
    } catch (error) {
        console.error('[DISTURB] Dynamic Cron Execution Failed:', error.message);
    }
});

// ⚡ REALTIME DB SYNC: DYNAMIC CRON UPDATE ⚡
app.post('/api/update-cron', async (req, res) => {
    const { userId, cronHour, cronMinute } = req.body;
    try {
        if (!db) throw new Error("Database not initialized");
        await db.ref(`users/${userId}`).update({ cronHour, cronMinute });
        console.log(`[DISTURB] Cron Matrix updated for ${userId}: ${cronHour}:${cronMinute}`);
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('[DISTURB] Cron Update Error:', error.message);
        res.status(500).json({ status: 'error' });
    }
});

// ⚡ MANUAL SCANNER API ⚡
app.get('/api/scan-calendar', async (req, res) => {
    const mode = req.query.mode || 'strict';
    const targetMinutes = parseInt(req.query.minutes) || 30;
    const deadline = parseInt(req.query.deadline) || 17;

    try {
        console.log(`[DISTURB] Commencing scan for ${targetMinutes}m before hour ${deadline}...`);
        const spotData = await findSleepSpot(targetMinutes, mode, deadline); 
        
        if (spotData.status === 'BREACH') {
            breachCount++;
            console.log(`[DISTURB] 🔴 BURNOUT BREACH LOGGED.`);
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
                exec(`osascript -e 'display notification "Cognitive recovery block initiates in 5 minutes. Wrap up your current task." with title "DISTURB"'`);
            }, warningTime - now);
        }

        const lockdownDelay = startTime - now;
        if (lockdownDelay > 0) {
            activeSession.lockTimer = setTimeout(async () => {
                try {
                    await axios.post('https://slack.com/api/dnd.setSnooze', new URLSearchParams({ token: process.env.SLACK_USER_TOKEN, num_minutes: minutes }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                    const returnTime = new Date(endTime).toLocaleTimeString('en-US', timeZoneConfig);
                    await axios.post('https://slack.com/api/users.profile.set', { profile: { status_text: `⚡ System Locked / Back at ${returnTime}`, status_emoji: ":disturb-blue:", status_expiration: 0 } }, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${process.env.SLACK_USER_TOKEN}` } });
                    exec('shortcuts run "DisturbOn"');
                    telemetryLog.push({ id: Date.now().toString(), user: "Babatunde", action: "LOCKED", durationRequested: minutes, timestamp: new Date().toISOString() });
                } catch (error) { console.error(error.message); }
            }, lockdownDelay);
        }

        const wakeDelay = endTime - now;
        if (wakeDelay > 0) {
            activeSession.wakeTimer = setTimeout(async () => {
                try {
                    await axios.post('https://slack.com/api/dnd.endDnd', new URLSearchParams({ token: process.env.SLACK_USER_TOKEN }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
                    await axios.post('https://slack.com/api/users.profile.set', { profile: { status_text: "", status_emoji: "" } }, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${process.env.SLACK_USER_TOKEN}` } });
                    exec('shortcuts run "DisturbOff"');
                    telemetryLog.push({ id: Date.now().toString(), user: "Babatunde", action: "AWAKE", timestamp: new Date().toISOString() });
                } catch (error) { console.error(error.message); }
            }, wakeDelay);
        }

        res.status(200).json({ status: 'success', message: 'System Armed.' });
    } catch (error) {
        res.status(500).json({ status: 'fatal', error: error.message });
    }
});

app.post('/api/clear-recovery', async (req, res) => {
    try {
        console.log('[DISTURB] ABORT PROTOCOL INITIATED.');
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
        
        res.status(200).json({ status: 'success', message: 'System aborted.' });
    } catch (error) {
        res.status(500).json({ status: 'fatal', error: error.message });
    }
});

app.get('/api/dashboard', (req, res) => {
    const totalSessions = telemetryLog.filter(log => log.action === 'LOCKED').length;
    const totalMinutesProtected = telemetryLog.filter(log => log.action === 'LOCKED').reduce((sum, log) => sum + log.durationRequested, 0);
    res.status(200).json({ 
        company: "Disturb Enterprise Client", 
        metrics: { 
            activeUsers: 1, 
            totalLockdownsExecuted: totalSessions, 
            totalMinutesProtected: totalMinutesProtected,
            burnoutBreachesLogged: breachCount 
        }, 
        rawLogs: telemetryLog 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[DISTURB] Command Center live on port ${PORT}`));