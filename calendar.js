// calendar.js
import fs from 'fs/promises';
import { google } from 'googleapis';

async function getAuthClient() {
    const credsContent = await fs.readFile('credentials.json', 'utf-8');
    const tokenContent = await fs.readFile('token.json', 'utf-8');
    const keys = JSON.parse(credsContent);
    const tokens = JSON.parse(tokenContent);
    const { client_secret, client_id } = keys.installed || keys.web;
    
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
    oAuth2Client.setCredentials(tokens);
    return oAuth2Client;
}

// ⚡ HELPER: Scans the entire day and returns ALL available gaps ⚡
function findGaps(busySlots, startLimit, endLimit, minDuration) {
    let gaps = [];
    let currentStart = new Date(startLimit.getTime() + 5 * 60000); // 5 min buffer from now

    for (const busy of busySlots) {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);

        if (busyStart > currentStart) {
            const diffMinutes = Math.floor((busyStart - currentStart) / 60000);
            if (diffMinutes >= minDuration) {
                gaps.push({
                    start: currentStart,
                    end: new Date(currentStart.getTime() + diffMinutes * 60000),
                    minutes: diffMinutes
                });
            }
        }
        // Buffer 5 mins after a meeting ends before the next block can start
        if (currentStart < busyEnd) {
            currentStart = new Date(busyEnd.getTime() + 5 * 60000);
        }
    }

    if (currentStart < endLimit) {
        const finalDiff = Math.floor((endLimit - currentStart) / 60000);
        if (finalDiff >= minDuration) {
            gaps.push({
                start: currentStart,
                end: new Date(currentStart.getTime() + finalDiff * 60000),
                minutes: finalDiff
            });
        }
    }
    return gaps;
}

// ⚡ PHASE 2: THE FALLBACK ENGINE ⚡
export async function findSleepSpot(durationMinutes = 30, mode = 'strict', deadlineHour = 17) {
    try {
        const auth = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });
        
        const now = new Date();
        const searchEnd = new Date(now);
        searchEnd.setHours(deadlineHour, 0, 0, 0);
        
        if (searchEnd <= now) {
            searchEnd.setTime(now.getTime() + 8 * 60 * 60 * 1000); 
        }

        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: now.toISOString(),
                timeMax: searchEnd.toISOString(),
                timeZone: 'America/Los_Angeles', 
                items: [{ id: 'primary' }]
            }
        });

        const busySlots = response.data.calendars.primary.busy;
        const absoluteFloor = 10; // The biological minimum for a recovery block

        // 🟢 TIER 1: The Ideal Target
        let availableGaps = findGaps(busySlots, now, searchEnd, durationMinutes);
        if (availableGaps.length > 0) {
            const gap = availableGaps[0];
            return {
                status: 'IDEAL',
                start: gap.start,
                end: new Date(gap.start.getTime() + durationMinutes * 60000),
                minutes: durationMinutes
            };
        }

        // 🟡 TIER 2: The Negotiation Protocol (Step down by 5 mins)
        let currentTarget = durationMinutes - 5;
        while (currentTarget >= absoluteFloor) {
            availableGaps = findGaps(busySlots, now, searchEnd, currentTarget);
            if (availableGaps.length > 0) {
                const gap = availableGaps[0];
                return {
                    status: 'NEGOTIATED',
                    start: gap.start,
                    end: new Date(gap.start.getTime() + currentTarget * 60000),
                    minutes: currentTarget,
                    originalTarget: durationMinutes
                };
            }
            currentTarget -= 5;
        }

        // 🟠 TIER 3: The Split-Shift
        const splitTarget = Math.max(absoluteFloor, Math.floor(durationMinutes / 2));
        availableGaps = findGaps(busySlots, now, searchEnd, splitTarget);
        
        if (availableGaps.length >= 2) {
            return {
                status: 'SPLIT',
                spots: [
                    { start: availableGaps[0].start, end: new Date(availableGaps[0].start.getTime() + splitTarget * 60000), minutes: splitTarget },
                    { start: availableGaps[1].start, end: new Date(availableGaps[1].start.getTime() + splitTarget * 60000), minutes: splitTarget }
                ],
                totalMinutes: splitTarget * 2,
                originalTarget: durationMinutes
            };
        }

        // 🔴 TIER 4: The Burnout Breach
        return {
            status: 'BREACH',
            originalTarget: durationMinutes
        };

    } catch (error) {
        console.error('[DISTURB] Calendar API Error:', error.message);
        throw error;
    }
}

export async function blockCalendarSpot(startTimeStr, endTimeStr) {
    try {
        const auth = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });

        const event = {
            summary: '⚡ FOCUS BLOCK (Disturb)',
            description: 'Automated cognitive recovery block injected by Disturb Enterprise System.',
            start: { dateTime: new Date(startTimeStr).toISOString(), timeZone: 'America/Los_Angeles' },
            end: { dateTime: new Date(endTimeStr).toISOString(), timeZone: 'America/Los_Angeles' },
            transparency: 'opaque', 
            colorId: '9',
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'popup', minutes: 0 } 
                ]
            }
        };

        const res = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });

        console.log(`[DISTURB] Focus Block Injected. Event ID: ${res.data.id}`);
        return res.data;
    } catch (error) {
        console.error('[DISTURB] Calendar Injection Error:', error.message);
        throw error;
    }
}

export async function removeCalendarSpot(eventId) {
    if (!eventId) return;
    try {
        const auth = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId,
        });
        console.log(`[DISTURB] Focus Block Annihilated. Event ID: ${eventId}`);
    } catch (error) {
        console.error('[DISTURB] Calendar Removal Error:', error.message);
    }
}