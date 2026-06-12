const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();

// FIX #1: Bind to Render's dynamic system environment variable
const PORT = process.env.PORT || 3000;

// FIX #2: Updated CORS to accept custom authorization headers from your HTML file
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-terminal-username', 'x-terminal-password']
}));

app.use(express.json());

// --- DATABASE FILE PERSISTENCE CONFIGURATION ---
const dbPath = path.join(__dirname, 'database.json');

// Helper to safely load data from disk on server bootup
function loadDatabase() {
    if (!fs.existsSync(dbPath)) {
        const initialData = {
            "admin": { 
                username: "admin",
                password: "admin123", 
                role: "admin", 
                created: new Date().toISOString(),
                lifespanRule: "unlimited",
                expiresAt: null
            }
        };
        fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 4), 'utf8');
        return initialData;
    }
    try {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
        console.error("[CRITICAL] Could not parse database file. Resetting to memory runtime snapshot state.");
        return {};
    }
}

// Helper to instantly commit database updates back to physical disk
function saveDatabase(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 4), 'utf8');
    } catch (e) {
        console.error("[CRITICAL] Failed writing update operations down to disk file storage context.", e);
    }
}

// Initialize file database reference assignment
let accountsDatabase = loadDatabase();

// --- CORE V GROUND HEX CONFIGURATIONS ---
const TICK_RATE = 60;
const DIG_SPEED_RATE = 25; 
const REJOIN_DELAY = 10; 

const SELECT_4_HEX = '0000001466bf0320cbbf812dfb45a3135e7f7f010003';
const SELECT_2_HEX = '0000000518bfd0f01fbe9cd2df44a291147f7f010001'; 

const LOOK_DOWN_BASE = '0000000491c0148111bfc90fdb4491affe7f7f0000';
const ACTION_TRIGGER = '06';
const JUMP_HEX = '00000023f5c0430dbcbddd400d460f88bf7f7f0001';
const FORWARD_HEX = '0000000247bfd482aebe4b890d440ff78c7f7f0002'; 
const STOP_HEX = '0000000047bfd482aebe4b890d440ff78c7f7f0000'; 

// System Task & Channel Sockets Registers
let activeCommands = {}; 
let commandGenerations = {}; 
let userHistory = {}; 

function authenticateRequest(req) {
    const username = req.body?.username || req.query?.username || req.headers['x-terminal-username'];
    const password = req.body?.password || req.query?.password || req.headers['x-terminal-password'];

    if (!username) return { valid: false, username: 'anonymous' };
    
    const targetUser = String(username).trim().toLowerCase();
    const match = accountsDatabase[targetUser];

    if (match && String(password).trim() === match.password) {
        if (match.role === 'expired') {
            return { valid: false, username: targetUser, isExpired: true };
        }
        return { valid: true, username: match.username, role: match.role };
    }
    return { valid: false, username: targetUser };
}

// Background Task Interval Loop: Automatic Expiry Evaluation Engine
setInterval(() => {
    const now = new Date();
    let dynamicChangeFlag = false;
    
    Object.keys(accountsDatabase).forEach(username => {
        const user = accountsDatabase[username];
        if (user.expiresAt && new Date(user.expiresAt) <= now) {
            if (user.lifespanRule === 'lose_access' && user.role !== 'expired') {
                user.role = 'expired';
                console.log(`[LIFESPAN LOCKOUT] User "${username}" marked as EXPIRED.`);
                forcePurgeUserSockets(username);
                dynamicChangeFlag = true;
            } else if (user.lifespanRule === 'deleted') {
                console.log(`[LIFESPAN DELETION] Purging account registry index for "${username}".`);
                forcePurgeUserSockets(username);
                delete accountsDatabase[username];
                dynamicChangeFlag = true;
            }
        }
    });

    if (dynamicChangeFlag) {
        saveDatabase(accountsDatabase);
    }
}, 1000);

function forcePurgeUserSockets(targetUser) {
    const sanitizedTarget = String(targetUser).trim().toLowerCase();

    Object.keys(activeCommands).forEach(genId => {
        if (activeCommands[genId].username.toLowerCase() === sanitizedTarget) {
            activeCommands[genId].killed = true;
            activeCommands[genId].timeouts.forEach(t => clearTimeout(t));
            activeCommands[genId].sockets.forEach(s => destroySocketSafely(s));
            delete activeCommands[genId];
        }
    });

    Object.keys(commandGenerations).forEach(key => {
        if (key.startsWith(`${sanitizedTarget}::`)) delete commandGenerations[key];
    });

    delete userHistory[sanitizedTarget];
}

function destroySocketSafely(ws) {
    if (!ws) return;
    try {
        ws.removeAllListeners();
        ws.on('error', () => {});
        if (ws._socket) ws._socket.destroy();
        ws.terminate();
    } catch (e) {}
}

// --- AUTOMATED BOT FRAME INSTANTIATION LOOP ---
function spawnBotInstance(generationId, taskId, botIndex, serverUrl, botMode, gameModeSelect, joinPayloadHex, durationSec) {
    if (!activeCommands[generationId] || activeCommands[generationId].killed) return;

    let ws;
    try {
        ws = new WebSocket(serverUrl, {
            headers: { 'Origin': 'https://voxiom.io' },
            perMessageDeflate: false
        });
    } catch(e) {
        return;
    }

    let loopInterval = null;
    let fallbackTimeout = null;
    let lifeTimeout = null;
    let altToggle = false;

    activeCommands[generationId].sockets.push(ws);

    const clearTimers = () => {
        if (loopInterval) clearInterval(loopInterval);
        if (fallbackTimeout) clearTimeout(fallbackTimeout);
        if (lifeTimeout) clearTimeout(lifeTimeout);
    };

    ws.on('open', () => {
        if (activeCommands[generationId].killed) {
            destroySocketSafely(ws);
            return;
        }
        ws.send('40');

        setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN || activeCommands[generationId].killed) {
                destroySocketSafely(ws);
                return;
            }

            ws.send(Buffer.from(joinPayloadHex, 'hex'));
            console.log(`[Task: ${taskId}] Instance #${botIndex} spawned into game grid.`);

            let weaponSelectHex = SELECT_4_HEX;
            if (gameModeSelect === 'battle_royal' && botMode === 'tower_building') {
                weaponSelectHex = SELECT_2_HEX;
            }

            if (botMode === 'fixed') {
                loopInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(FORWARD_HEX, 'hex'));
                }, 20);
                fallbackTimeout = setTimeout(() => {
                    clearInterval(loopInterval);
                    if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(STOP_HEX, 'hex'));
                }, 20);
            } 
            else if (botMode === 'tower_building') {
                ws.send(Buffer.from(weaponSelectHex, 'hex'));
                loopInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        let pkt = LOOK_DOWN_BASE.slice(0, -1) + (altToggle ? "1" : "2");
                        ws.send(Buffer.from(pkt, 'hex'));
                        ws.send(Buffer.from(weaponSelectHex, 'hex'));
                        altToggle = !altToggle;
                    }
                }, TICK_RATE);
            } 
            else if (botMode === 'digging') {
                loopInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        let pkt = LOOK_DOWN_BASE.slice(0, -1) + "2";
                        ws.send(Buffer.from(pkt, 'hex'));
                        ws.send(Buffer.from(ACTION_TRIGGER, 'hex'));
                    }
                }, DIG_SPEED_RATE);
            } 
            else if (botMode === 'jumping') {
                loopInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(JUMP_HEX, 'hex'));
                }, 20);
            }

            lifeTimeout = setTimeout(() => {
                clearTimers();
                ws.close();
            }, parseFloat(durationSec) * 1000);
            activeCommands[generationId].timeouts.push(lifeTimeout);

        }, 150);
    });

    ws.on('close', () => {
        clearTimers();
        if (activeCommands[generationId]) {
            activeCommands[generationId].sockets = activeCommands[generationId].sockets.filter(s => s !== ws);
            if (!activeCommands[generationId].killed) {
                setTimeout(() => {
                    spawnBotInstance(generationId, taskId, botIndex, serverUrl, botMode, gameModeSelect, joinPayloadHex, durationSec);
                }, REJOIN_DELAY);
            }
        }
    });

    ws.on('error', () => {
        clearTimers();
        destroySocketSafely(ws);
    });
}

// --- GATEWAY OPERATIONS ROUTING CONTROL MAP ---
app.post('/api/login', (req, res) => {
    const auth = authenticateRequest(req);
    if (auth.isExpired) {
        return res.status(403).json({ status: "error", message: "Forbidden: Operational lease has closed." });
    }
    if (!auth.valid) {
        return res.status(401).json({ status: "error", message: "Access Denied: Invalid Credentials Loop." });
    }
    res.json({ status: "success", username: auth.username, role: accountsDatabase[auth.username.toLowerCase()].role });
});

app.post('/api/admin/create-user', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid || auth.role !== 'admin') {
        return res.status(403).json({ status: "error", message: "Unauthorized clearance level." });
    }

    const { newUsername, newPassword, newRole } = req.body;
    if (!newUsername || !newPassword) {
        return res.status(400).json({ status: "error", message: "Missing inputs." });
    }

    const targetKey = String(newUsername).trim().toLowerCase();
    if (accountsDatabase[targetKey]) {
        return res.status(409).json({ status: "error", message: "User already exists." });
    }

    accountsDatabase[targetKey] = {
        username: String(newUsername).trim(), 
        password: String(newPassword).trim(),
        role: newRole === 'admin' ? 'admin' : 'standard',
        created: new Date().toISOString(),
        lifespanRule: "unlimited",
        expiresAt: null
    };

    saveDatabase(accountsDatabase);
    res.json({ status: "success", message: `Provisioned profile entity [${accountsDatabase[targetKey].username}].` });
});

app.post('/api/admin/update-user', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid || auth.role !== 'admin') {
        return res.status(403).json({ status: "error", message: "Unauthorized action configuration access status." });
    }

    const { actionType, targetUsername, newUsername, newPassword, role, lifespanRule, absoluteExpiry, days, mins, secs } = req.body;
    
    if (!targetUsername) {
        return res.status(400).json({ status: "error", message: "Missing parameter target profile reference key." });
    }

    const oldKey = String(targetUsername).trim().toLowerCase();
    if (!accountsDatabase[oldKey]) {
        return res.status(404).json({ status: "error", message: "Requested profile index map target missing." });
    }

    let userData = accountsDatabase[oldKey];

    if (actionType === 'identity_patch') {
        if (newPassword && newPassword !== "") userData.password = String(newPassword).trim();
        if (role) userData.role = role;

        const rawNewName = newUsername ? String(newUsername).trim() : userData.username;
        const newKey = rawNewName.toLowerCase();

        userData.username = rawNewName;

        if (oldKey !== newKey) {
            if (accountsDatabase[newKey]) {
                return res.status(409).json({ status: "error", message: "Conflict: Target username string already exists." });
            }
            accountsDatabase[newKey] = userData;
            delete accountsDatabase[oldKey];
            
            Object.keys(commandGenerations).forEach(key => {
                if (key.startsWith(`${oldKey}::`)) {
                    const taskId = key.split('::')[1];
                    const genId = commandGenerations[key];
                    commandGenerations[`${newKey}::${taskId}`] = genId;
                    delete commandGenerations[key];
                }
            });
            
            if (userHistory[oldKey]) {
                userHistory[newKey] = userHistory[oldKey];
                delete userHistory[oldKey];
            }
        } else {
            accountsDatabase[oldKey] = userData;
        }

        saveDatabase(accountsDatabase);
        return res.json({ status: "success", message: `Successfully updated credentials profile for [${rawNewName}].` });
    }

    if (actionType === 'lifespan_patch') {
        if (lifespanRule) userData.lifespanRule = lifespanRule;

        if (lifespanRule === 'unlimited') {
            userData.expiresAt = null;
            if (userData.role === 'expired') userData.role = 'standard';
        } else {
            if (absoluteExpiry && absoluteExpiry !== "") {
                userData.expiresAt = new Date(absoluteExpiry).toISOString();
                if (new Date(userData.expiresAt) > new Date() && userData.role === 'expired') {
                    userData.role = 'standard';
                }
            } else {
                const addDays = parseInt(days) || 0;
                const addMins = parseInt(mins) || 0;
                const addSecs = parseInt(secs) || 0;

                if (addDays > 0 || addMins > 0 || addSecs > 0) {
                    let calculatedDate = new Date();
                    calculatedDate.setDate(calculatedDate.getDate() + addDays);
                    calculatedDate.setMinutes(calculatedDate.getMinutes() + addMins);
                    calculatedDate.setSeconds(calculatedDate.getSeconds() + addSecs);
                    userData.expiresAt = calculatedDate.toISOString();
                    
                    if (userData.role === 'expired') userData.role = 'standard';
                } else if (!userData.expiresAt) {
                    let defaultExpiry = new Date();
                    defaultExpiry.setMinutes(defaultExpiry.getMinutes() + 60); 
                    userData.expiresAt = defaultExpiry.toISOString();
                }
            }
        }
        accountsDatabase[oldKey] = userData;

        saveDatabase(accountsDatabase);
        return res.json({ status: "success", message: `Successfully committed dynamic temporal rule configuration for [${userData.username}].` });
    }

    res.status(400).json({ status: "error", message: "Invalid action type deployment string payload." });
});

app.post('/api/admin/delete-user', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid || auth.role !== 'admin') {
        return res.status(403).json({ status: "error", message: "Unauthorized action." });
    }

    const targetKey = String(req.body.targetUsername).trim().toLowerCase();
    if (!accountsDatabase[targetKey]) {
        return res.status(404).json({ status: "error", message: "Target profile does not exist." });
    }

    forcePurgeUserSockets(targetKey);
    delete accountsDatabase[targetKey];

    saveDatabase(accountsDatabase);
    res.json({ status: "success", message: `Identity [${targetKey}] scrubbed cleanly.` });
});

app.get('/api/admin/accounts', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid || auth.role !== 'admin') {
        return res.status(403).json({ status: "error", message: "Access Denied." });
    }
    
    const statusLogs = Object.keys(accountsDatabase).map(user => {
        let currentActiveTaskCount = 0;
        let taskDetails = [];

        Object.keys(commandGenerations).forEach(key => {
            if (key.startsWith(`${user}::`)) {
                const taskId = key.split('::')[1];
                const genId = commandGenerations[key];
                if (activeCommands[genId] && !activeCommands[genId].killed) {
                    const socketCount = activeCommands[genId].sockets.length;
                    currentActiveTaskCount += socketCount;
                    taskDetails.push({
                        taskId: taskId,
                        activeSockets: socketCount
                    });
                }
            }
        });

        return {
            username: accountsDatabase[user].username || user,
            password: accountsDatabase[user].password,
            role: accountsDatabase[user].role,
            created: accountsDatabase[user].created,
            lifespanRule: accountsDatabase[user].lifespanRule,
            expiresAt: accountsDatabase[user].expiresAt,
            isCurrentlyRunning: currentActiveTaskCount > 0,
            activeSockets: currentActiveTaskCount,
            tasks: taskDetails
        };
    });
    res.json(statusLogs);
});

app.post('/api/admin/clear-specific-task', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid || auth.role !== 'admin') {
        return res.status(403).json({ status: "error", message: "Unauthorized" });
    }

    const { targetUsername, taskId } = req.body;
    const scopedTrackingKey = `${String(targetUsername).toLowerCase()}::${taskId}`;
    const genId = commandGenerations[scopedTrackingKey];

    if (genId && activeCommands[genId]) {
        activeCommands[genId].killed = true;
        activeCommands[genId].timeouts.forEach(t => clearTimeout(t));
        activeCommands[genId].sockets.forEach(s => destroySocketSafely(s));
        delete activeCommands[genId];
    }
    delete commandGenerations[scopedTrackingKey];
    res.json({ status: "success", message: `Task ${taskId} dropped for ${targetUsername}.` });
});

app.post('/api/admin/clear-user-activity', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid || auth.role !== 'admin') {
        return res.status(403).json({ status: "error", message: "Unauthorized Access Level." });
    }

    const targetUser = req.body.targetUsername;
    if (!targetUser) return res.status(400).json({ status: "error", message: "Target unmapped." });

    forcePurgeUserSockets(targetUser);
    res.json({ status: "success", message: `Wiped all processing traces for user: ${targetUser}` });
});

app.get('/api/tasks', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const username = auth.username.toLowerCase();
    let userTasks = [];

    Object.keys(commandGenerations).forEach(key => {
        if (key.startsWith(`${username}::`)) {
            const taskId = key.split('::')[1];
            const genId = commandGenerations[key];
            if (activeCommands[genId] && !activeCommands[genId].killed) {
                userTasks.push({
                    taskId: taskId,
                    botCount: activeCommands[genId].sockets.length
                });
            }
        }
    });

    res.json(userTasks);
});

app.post('/api/deploy', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid) return res.status(401).json({ status: "error", message: "Unauthorized execution block." });

    const { taskId, serverUrl, botCount, durationSec, gameModeSelect, botMode, primaryWeapon, secondaryWeapon } = req.body;
    
    const username = auth.username;
    const trackingUserKey = username.toLowerCase();
    const scopedTrackingKey = `${trackingUserKey}::${taskId}`;
    
    if (commandGenerations[scopedTrackingKey]) {
        let oldGen = commandGenerations[scopedTrackingKey];
        if (activeCommands[oldGen]) {
            activeCommands[oldGen].killed = true;
            activeCommands[oldGen].timeouts.forEach(t => clearTimeout(t));
            activeCommands[oldGen].sockets.forEach(s => destroySocketSafely(s));
            delete activeCommands[oldGen];
        }
    }

    const generationId = 'GEN-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    commandGenerations[scopedTrackingKey] = generationId;
    
    const parsedBotCount = parseInt(botCount, 10) || 1;

    activeCommands[generationId] = {
        killed: false,
        sockets: [],
        timeouts: [],
        targetCount: parsedBotCount,
        username: username,
        taskId: taskId
    };

    if (!userHistory[trackingUserKey]) userHistory[trackingUserKey] = [];
    userHistory[trackingUserKey].push(generationId);

    const weapon1Hex = primaryWeapon || '01';
    const weapon2Hex = secondaryWeapon || '01';
    const joinPayloadHex = `0387${weapon1Hex}${weapon2Hex}05`;

    res.json({ 
        status: "success", 
        message: `Pipeline active for: ${username}`, 
        assignedUser: username 
    });

    const DEPLOY_GAP_SEC = 0.1;

    for (let i = 1; i <= parsedBotCount; i++) {
        if (botMode === 'fixed') {
            const staggerDelayMs = (i - 1) * (DEPLOY_GAP_SEC * 1000);
            
            const gapTimeout = setTimeout(() => {
                if (activeCommands[generationId] && !activeCommands[generationId].killed) {
                    spawnBotInstance(generationId, taskId, i, serverUrl, botMode, gameModeSelect, joinPayloadHex, durationSec);
                }
            }, staggerDelayMs);
            
            activeCommands[generationId].timeouts.push(gapTimeout);
        } else {
            spawnBotInstance(generationId, taskId, i, serverUrl, botMode, gameModeSelect, joinPayloadHex, durationSec);
        }
    }
});

app.get('/api/status/:taskId', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const username = auth.username.toLowerCase();
    const scopedTrackingKey = `${username}::${req.params.taskId}`;
    const genId = commandGenerations[scopedTrackingKey];
    
    if (!genId || !activeCommands[genId] || activeCommands[genId].killed) {
        return res.json({ status: "inactive", activeBotCount: 0, username: auth.username });
    }
    res.json({ status: "running", activeBotCount: activeCommands[genId].sockets.length, username: auth.username });
});

app.post('/api/clear/:taskId', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const username = auth.username.toLowerCase();
    const scopedTrackingKey = `${username}::${req.params.taskId}`;
    const genId = commandGenerations[scopedTrackingKey];
    
    if (genId && activeCommands[genId]) {
        activeCommands[genId].killed = true;
        activeCommands[genId].timeouts.forEach(t => clearTimeout(t));
        activeCommands[genId].sockets.forEach(s => destroySocketSafely(s));
        delete activeCommands[genId];
        
        if (userHistory[username]) {
            userHistory[username] = userHistory[username].filter(id => id !== genId);
        }
    }
    delete commandGenerations[scopedTrackingKey];
    res.json({ message: `Pipeline ${req.params.taskId} dropped.` });
});

app.post('/api/kill-last', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const username = auth.username.toLowerCase();
    if (!userHistory[username] || userHistory[username].length === 0) {
        return res.json({ success: false, message: `No target history profile mapped for user: ${auth.username}` });
    }

    let lastGenId = userHistory[username].pop();

    if (activeCommands[lastGenId]) {
        const targetTaskId = activeCommands[lastGenId].taskId;
        activeCommands[lastGenId].killed = true;
        activeCommands[lastGenId].timeouts.forEach(t => clearTimeout(t));
        activeCommands[lastGenId].sockets.forEach(s => destroySocketSafely(s));
        delete activeCommands[lastGenId];
        
        Object.keys(commandGenerations).forEach(key => {
            if (commandGenerations[key] === lastGenId) delete commandGenerations[key];
        });

        return res.json({ success: true, message: `Terminated last matrix thread for user: ${auth.username}`, killedTaskId: targetTaskId });
    }
    res.json({ success: false, message: `Target channel structural error.` });
});

app.post('/api/kill', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.valid) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const username = auth.username;
    forcePurgeUserSockets(username);
    res.json({ message: `All instances registered to user ${username} dropped.` });
});

// Use the dynamically assigned port variable
app.listen(PORT, () => { console.log(`Backend context running on port ${PORT}`); });
