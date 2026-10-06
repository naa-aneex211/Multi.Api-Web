require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const compression = require('compression');
const app = express();

app.use(compression());
app.use(express.json());
const cors = require('cors');
app.use(cors());

const SECRET_KEY = process.env.SECRET_KEY 
const rooms = new Map();

app.get('/', (req, res) => {
    res.redirect('/dashboard');
});

app.get('/ping', (req, res) => {
    res.status(200).send("Pong! Meyy Hub is Awake ");
});

app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

app.get('/dashboard-data', (req, res) => {
    let allData = {};
    const currentTime = Math.floor(Date.now() / 1000);

    for (let [service, serviceRooms] of rooms.entries()) {
        allData[service] = {};
        for (let [group, groupAccounts] of serviceRooms.entries()) {
            allData[service][group] = {};
            for (let [accName, accData] of groupAccounts.entries()) {
                let isOnline = (currentTime - accData.LastTime <= 300);
                allData[service][group][accName] = {
                    ...accData,
                    Status: isOnline ? "Online" : "Offline"
                };
            }
        }
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(allData, null, 4));
});


app.get('/see', (req, res) => {
    let rawRoomsData = {};
    const currentTime = Math.floor(Date.now() / 1000);

    for (let [service, serviceRooms] of rooms.entries()) {
        rawRoomsData[service] = {};
        for (let [group, groupAccounts] of serviceRooms.entries()) {
            rawRoomsData[service][group] = {};
            for (let [accName, accData] of groupAccounts.entries()) {
                rawRoomsData[service][group][accName] = {
                    ...accData,
                    Online: (currentTime - (accData.LastTime || 0) <= 300),
                    AgeSeconds: currentTime - (accData.LastTime || 0)
                };
            }
        }
    }

    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(rawRoomsData, null, 4));
});

app.use((req, res, next) => {
    const group = req.headers['x-group'];
    const timestamp = parseInt(req.headers['x-timestamp']);
    const signature = req.headers['x-signature'];

    if (!group || !timestamp || !signature) return res.status(401).send("Missing Headers");
    
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 60) return res.status(401).send("Expired Request");

    let dataToHash = timestamp.toString() + group;
    if (req.method === 'POST' && req.body) {
        dataToHash += (req.body.Name || ""); 
    }

    const expectedSig = crypto.createHash('sha256').update(dataToHash + SECRET_KEY).digest('hex');
    if (signature !== expectedSig) return res.status(401).send("Invalid Signature"); 

    req.group = group; 
    next();
});
// Thêm Map lưu trữ trạng thái ghép cặp riêng cho v4
const matchGroups = new Map();

function generateToken() {
    return crypto.randomBytes(8).toString('hex');
}

function processV4Match(groupName, groupAccounts, reqBody) {
    const currentTime = Math.floor(Date.now() / 1000);
    let myAccName = reqBody.Name || reqBody.username;
    let myRole = reqBody.role || "none";
    let myJob = reqBody.job_id || "";

    // Cập nhật thông tin acc hiện tại
    if (!groupAccounts.has(myAccName)) {
        groupAccounts.set(myAccName, {});
    }
    let accData = groupAccounts.get(myAccName);
    accData.Name = myAccName;
    accData.role = myRole;
    accData.job_id = myJob;
    accData.queue_ready = reqBody.queue_ready;
    accData.LastTime = currentTime;
    
    // Khởi tạo phòng ghép cặp cho group nếu chưa có
    if (!matchGroups.has(groupName)) {
        matchGroups.set(groupName, {
            activeGroupId: "",
            mainName: "",
            helpers: [],
            mainJob: "",
            turnToken: ""
        });
    }
    let matchSession = matchGroups.get(groupName);

    // Lọc các acc đang online và ready
    let mainsReady = [];
    let helpsReady = [];
    
    for (let [name, data] of groupAccounts.entries()) {
        if (currentTime - data.LastTime <= 120 && data.queue_ready) {
            if (data.role === "upgear") mainsReady.push(data);
            if (data.role === "allies") helpsReady.push(data);
        }
    }

    // Nếu phòng trống, thử tạo cặp mới
    if (matchSession.mainName === "") {
        if (mainsReady.length >= 1 && helpsReady.length >= 2) {
            matchSession.mainName = mainsReady[0].Name;
            matchSession.mainJob = mainsReady[0].job_id;
            matchSession.helpers = [helpsReady[0].Name, helpsReady[1].Name];
            matchSession.activeGroupId = "Group_" + Date.now();
            matchSession.turnToken = generateToken();
        }
    } else {
        // Kiểm tra xem cặp hiện tại còn online không, nếu rụng thì giải tán
        let mainAlive = groupAccounts.has(matchSession.mainName) && (currentTime - groupAccounts.get(matchSession.mainName).LastTime <= 120);
        let help1Alive = groupAccounts.has(matchSession.helpers[0]) && (currentTime - groupAccounts.get(matchSession.helpers[0]).LastTime <= 120);
        let help2Alive = groupAccounts.has(matchSession.helpers[1]) && (currentTime - groupAccounts.get(matchSession.helpers[1]).LastTime <= 120);
        
        if (!mainAlive || (!help1Alive && !help2Alive)) {
            matchSession.mainName = "";
            matchSession.helpers = [];
            matchSession.activeGroupId = "";
            matchSession.mainJob = "";
            matchSession.turnToken = "";
        } else {
            // Cập nhật job theo Main
            if (mainAlive) matchSession.mainJob = groupAccounts.get(matchSession.mainName).job_id;
        }
    }

    // Tạo response chuẩn cho Kaitun V4
    let isAssigned = false;
    let isMyTurn = false;
    
    if (matchSession.mainName === myAccName) {
        isAssigned = true;
        isMyTurn = true;
    } else if (matchSession.helpers.includes(myAccName)) {
        isAssigned = true;
    }

    // Kiểm tra xem tất cả đã chung mâm (chung job_id) chưa
    let allInJob = false;
    if (isAssigned && matchSession.mainJob !== "") {
        allInJob = true;
        let mainAcc = groupAccounts.get(matchSession.mainName);
        if (!mainAcc || mainAcc.job_id !== matchSession.mainJob) allInJob = false;
        matchSession.helpers.forEach(h => {
            let helpAcc = groupAccounts.get(h);
            if (!helpAcc || helpAcc.job_id !== matchSession.mainJob) allInJob = false;
        });
    }

    return {
        ok: true,
        assigned: isAssigned,
        group_id: matchSession.activeGroupId,
        main_username: matchSession.mainName,
        active_main: matchSession.mainName,
        helpers: matchSession.helpers,
        main_job_id: matchSession.mainJob,
        target_job_id: matchSession.mainJob,
        turn_token: isMyTurn ? matchSession.turnToken : "",
        trial_turn: isMyTurn,
        can_approach_trial: isAssigned && allInJob,
        all_in_job: allInJob,
        queue_position: isAssigned ? 0 : 1
    };
}

app.post('/api/v4/match/release', (req, res) => {
    let groupName = req.group;
    if (matchGroups.has(groupName)) {
        let matchSession = matchGroups.get(groupName);
        // Chỉ cho phép Main giải tán phòng
        if (matchSession.mainName === (req.body.Name || req.body.username)) {
            matchSession.mainName = "";
            matchSession.helpers = [];
            matchSession.activeGroupId = "";
            matchSession.mainJob = "";
            matchSession.turnToken = "";
            return res.json({ ok: true, released: true, leave_server: true });
        }
    }
    return res.json({ ok: true, released: false });
});

app.get('/api/:service', (req, res) => {
    res.json(buildFinalOutput(req.params.service, req.group));
});

app.post('/api/:service', (req, res) => {
    const serviceName = req.params.service;
    const bodyData = req.body; 
    
    let accName = bodyData.Name || bodyData.username;
    if (!accName) return res.status(400).send("Missing Name");

    if (!rooms.has(serviceName)) rooms.set(serviceName, new Map());
    const serviceRooms = rooms.get(serviceName);

    if (!serviceRooms.has(req.group)) serviceRooms.set(req.group, new Map());
    const groupAccounts = serviceRooms.get(req.group);

    // Xử lý riêng cho luồng v4 match
    if (serviceName === "v4" || serviceName === "v4/match") {
        let response = processV4Match(req.group, groupAccounts, bodyData);
        return res.json(response);
    }

    const currentTime = Math.floor(Date.now() / 1000);
    bodyData.LastTime = currentTime; 
    groupAccounts.set(accName, bodyData);

    res.json(buildFinalOutput(serviceName, req.group));
});

function buildFinalOutput(service, group) {
    if (!rooms.has(service)) return {};
    const serviceRooms = rooms.get(service);
    if (!serviceRooms.has(group)) return {};
    const groupAccounts = serviceRooms.get(group);

    const currentTime = Math.floor(Date.now() / 1000);
    let finalOutput = {};

    // Lọc acc quá hạn 300s
    for (let [key, val] of groupAccounts.entries()) {
        if (currentTime - val.LastTime > 900) {
            groupAccounts.delete(key);
        } else {
            finalOutput[val.Name || key] = val;
        }
    }

    return finalOutput;
}

app.listen(3000, () => {
    console.log('Meyy Hub API is running on port');
});
