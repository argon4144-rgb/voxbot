const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable Cross-Origin Resource Sharing and JSON parsing
app.use(cors());
app.use(bodyParser.json());

// In-Memory Database Initialization
let accounts = [
    {
        username: "admin",
        password: "admin123",
        role: "admin",
        expiresAt: null, // null means unlimited
        lifespanRule: "unlimited",
        tasks: [],
        activeSockets: 0
    },
    {
        username: "operator1",
        password: "user123",
        role: "standard",
        expiresAt: new Date(Date.now() + 3600 * 1000 * 2).toISOString(), // 2 hours from now
        lifespanRule: "lose_access",
        tasks: [],
        activeSockets: 0
    }
];

// --- MIDDLEWARE TO AUTHENTICATE INCOMING HEADERS ---
function authenticateTerminal(req, res, next) {
    const username = req.headers['x-terminal-username'];
    const password = req.headers['x-terminal-password'];

    if (!username || !password) {
        return res.status(401).json({ status: "error", message: "Missing authorization credentials." });
    }

    const user = accounts.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
    if (!user) {
        return res.status(401).json({ status: "error", message: "Invalid authorization credentials." });
    }

    // Check expiration boundaries for standard users
    if (user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()) {
        if (user.lifespanRule === 'deleted') {
            accounts = accounts.filter(u => u.username.toLowerCase() !== username.toLowerCase());
            return res.status(403).json({ status: "error", message: "Account lifespan has terminated and profile was purged." });
        }
        return res.status(403).json({ status: "error", message: "Terminal Access Expired. Reach supervisor out to patch lease duration." });
    }

    req.user = user;
    next();
}

function verifyAdminClearance(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ status: "error", message: "Access Denied: Administrative clearance level required." });
    }
    next();
}

// --- STANDARD OPERATOR API ROUTES ---

// 1. Session Gateway Login Endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ status: "error", message: "Username and password specifications are mandatory." });
    }

    const user = accounts.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
    if (!user) {
        return res.status(401).json({ status: "error", message: "Engine connection rejected: Unknown identity metrics." });
    }

    if (user.expiresAt && new Date(user.expiresAt).getTime() < Date.now()) {
        return res.status(403).json({ status: "error", message: "Linked token status: EXPIRED lease lifespan matrix rules." });
    }

    res.json({
        status: "success",
        message: "Authentication established successfully.",
        role: user.role,
        username: user.username
    });
});

// 2. Query Deployment Tasks Flow Stream
app.get('/api/tasks', authenticateTerminal, (req, res) => {
    res.json(req.user.tasks);
});

// 3. Spawning Vector Pipeline Matrix
app.post('/api/deploy', authenticateTerminal, (req, res) => {
    const { taskId, serverUrl, botCount, durationSec, gameModeSelect, botMode, primaryWeapon, secondaryWeapon } = req.body;

    if (!taskId || !serverUrl) {
        return res.status(400).json({ status: "success", message: "Configuration mapping incomplete." });
    }

    const newTask = {
        taskId,
        serverUrl,
        botCount: parseInt(botCount, 10) || 1,
        durationSec: parseFloat(durationSec) || 60,
        gameModeSelect,
        botMode,
        primaryWeapon,
        secondaryWeapon,
        deployedAt: new Date().toISOString()
    };

    req.user.tasks.push(newTask);
    req.user.activeSockets += newTask.botCount;

    // Simulate lifecycle expiration loop automation triggers
    setTimeout(() => {
        req.user.tasks = req.user.tasks.filter(t => t.taskId !== taskId);
        if (req.user.activeSockets >= newTask.botCount) {
            req.user.activeSockets -= newTask.botCount;
        }
    }, newTask.durationSec * 1000);

    res.json({
        status: "success",
        message: `Pipeline active. Deployed ${newTask.botCount} stream threads to target node cluster.`
    });
});

// 4. Kill and Purge Last Spawned Task
app.post('/api/kill-last', authenticateTerminal, (req, res) => {
    if (req.user.tasks.length === 0) {
        return res.json({ status: "success", message: "Active stack clear. No execution routines detected." });
    }

    const terminatedTask = req.user.tasks.pop();
    if (req.user.activeSockets >= terminatedTask.botCount) {
        req.user.activeSockets -= terminatedTask.botCount;
    }

    res.json({
        status: "success",
        message: `Manually terminated last stream pipeline container context: ${terminatedTask.taskId.split('-')[0]}`
    });
});

// 5. Explicit Stream Array Segment Clearing Route
app.post('/api/clear/:taskId', authenticateTerminal, (req, res) => {
    const { taskId } = req.params;
    const taskIndex = req.user.tasks.findIndex(t => t.taskId === taskId);

    if (taskIndex !== -1) {
        const [removedTask] = req.user.tasks.splice(taskIndex, 1);
        if (req.user.activeSockets >= removedTask.botCount) {
            req.user.activeSockets -= removedTask.botCount;
        }
    }
    res.json({ status: "success", message: "Target pipeline stream channel closed." });
});


// --- ROOT ADMINISTRATOR SECURITY GATE CONTROL CHANNELS ---

// 1. Fetch Complete Master State Database Profiles
app.get('/api/admin/accounts', authenticateTerminal, verifyAdminClearance, (req, res) => {
    res.json(accounts);
});

// 2. Provision New Profile Credentials
app.post('/api/admin/create-user', authenticateTerminal, verifyAdminClearance, (req, res) => {
    const { newUsername, newPassword, newRole } = req.body;

    if (!newUsername || !newPassword) {
        return res.json({ status: "error", message: "Provision rejected: Invalid argument specifications." });
    }

    const collisionCheck = accounts.find(u => u.username.toLowerCase() === newUsername.toLowerCase().trim());
    if (collisionCheck) {
        return res.json({ status: "error", message: "Profile creation error: Username identity registry conflict." });
    }

    const profileStructure = {
        username: newUsername.trim(),
        password: newPassword.trim(),
        role: newRole === 'admin' ? 'admin' : 'standard',
        expiresAt: null,
        lifespanRule: "unlimited",
        tasks: [],
        activeSockets: 0
    };

    accounts.push(profileStructure);
    res.json({ status: "success", message: `Account profile '${profileStructure.username}' provisioned onto nodes.` });
});

// 3. Drop Profile Credentials Frame
app.post('/api/admin/delete-user', authenticateTerminal, verifyAdminClearance, (req, res) => {
    const { targetUsername } = req.body;
    
    if (targetUsername.toLowerCase() === req.user.username.toLowerCase()) {
        return res.json({ status: "error", message: "Operation Aborted: self-destruction loop logic denied." });
    }

    const initialLength = accounts.length;
    accounts = accounts.filter(u => u.username.toLowerCase() !== targetUsername.toLowerCase().trim());

    if (accounts.length === initialLength) {
        return res.json({ status: "error", message: "Target database frame entity could not be mapped." });
    }

    res.json({ status: "success", message: "Target account identity matrix dropped from stack core safely." });
});

// 4. Update Profile Configurations (Identity Matrix & Leases Lifespans Rules)
app.post('/api/admin/update-user', authenticateTerminal, verifyAdminClearance, (req, res) => {
    const { actionType, targetUsername, newUsername, newPassword, role, lifespanRule, days, mins, secs } = req.body;
    
    const profile = accounts.find(u => u.username.toLowerCase() === targetUsername.toLowerCase().trim());
    if (!profile) {
        return res.json({ status: "error", message: "User workspace lookup fault reference." });
    }

    if (actionType === 'identity_patch') {
        if (newUsername && newUsername.trim().toLowerCase() !== targetUsername.toLowerCase()) {
            const doubleBooking = accounts.find(u => u.username.toLowerCase() === newUsername.trim().toLowerCase());
            if (doubleBooking) return res.json({ status: "error", message: "Conflict: Identity namespace reserved." });
            profile.username = newUsername.trim();
        }
        if (newPassword) profile.password = newPassword.trim();
        if (role) profile.role = role;

        return res.json({ status: "success", message: "Base security identity properties updated." });
    } 
    
    if (actionType === 'lifespan_patch') {
        profile.lifespanRule = lifespanRule || 'unlimited';
        
        if (lifespanRule === 'unlimited') {
            profile.expiresAt = null;
        } else {
            const totalMsOffsets = ((parseInt(days, 10) || 0) * 86400 + (parseInt(mins, 10) || 0) * 60 + (parseInt(secs, 10) || 0)) * 1000;
            if (totalMsOffsets <= 0) {
                return res.json({ status: "error", message: "Temporal configuration parameters must yield a positive range." });
            }
            profile.expiresAt = new Date(Date.now() + totalMsOffsets).toISOString();
        }

        return res.json({ status: "success", message: "Lease timeline lifespan bounds restructured successfully." });
    }

    res.json({ status: "error", message: "Unknown patch action parameters context rule." });
});

// 5. Clear Target Stream Array Matrix logs
app.post('/api/admin/clear-user-activity', authenticateTerminal, verifyAdminClearance, (req, res) => {
    const { targetUsername } = req.body;
    const profile = accounts.find(u => u.username.toLowerCase() === targetUsername.toLowerCase().trim());

    if (!profile) return res.json({ status: "error", message: "User profile trace channels unmapped." });

    profile.tasks = [];
    profile.activeSockets = 0;
    res.json({ status: "success", message: "All operation activity metrics and active pipeline allocations zeroed out." });
});

// 6. Administrative Force Disconnection on Specific Thread
app.post('/api/admin/clear-specific-task', authenticateTerminal, verifyAdminClearance, (req, res) => {
    const { targetUsername, taskId } = req.body;
    const profile = accounts.find(u => u.username.toLowerCase() === targetUsername.toLowerCase().trim());

    if (!profile) return res.json({ status: "error", message: "Profile workspace mapping broken link." });

    const taskIndex = profile.tasks.findIndex(t => t.taskId === taskId);
    if (taskIndex !== -1) {
        const [droppedTask] = profile.tasks.splice(taskIndex, 1);
        if (profile.activeSockets >= droppedTask.botCount) {
            profile.activeSockets -= droppedTask.botCount;
        }
        return res.json({ status: "success", message: "Task trace channel isolated and purged from administrative core." });
    }

    res.json({ status: "error", message: "Target trace task identity missing on profile matrix." });
});

// Fallback error boundary layout
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ status: "error", message: "Fatal Application Stack Crash Trace Exception Error." });
});

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`[SYSTEM STARTED] BOT MGR Operations Server Node Online`);
    console.log(`[PORT RUNNING] Listening on interface port: ${PORT}`);
    console.log(`====================================================`);
});
