require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const SECRET_KEY = process.env.SECRET_KEY 
const rooms = new Map();

app.get('/ping', (req, res) => {
    res.status(200).send("Pong! Meyy Hub is Awake (｡◕‿◕｡)");
});
app.get('/dashboard', (req, res) => {
    if (req.query.pass !== SECRET_KEY) {
        return res.status(401).send("Hông có pass hông cho xem đâuu (๑•́ ₃ •̀๑)");
    }

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
                    Status: isOnline ? "Online 🟢" : "Offline 🔴 (Sắp bị clear)"
                };
            }
        }
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(allData, null, 4));
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
app.get('/api/:service', (req, res) => {
    res.json(buildFinalOutput(req.params.service, req.group));
});

app.post('/api/:service', (req, res) => {
    const serviceName = req.params.service;
    const bodyData = req.body; 
    
    if (!bodyData || !bodyData.Name) return res.status(400).send("Missing Name");

    if (!rooms.has(serviceName)) rooms.set(serviceName, new Map());
    const serviceRooms = rooms.get(serviceName);

    if (!serviceRooms.has(req.group)) serviceRooms.set(req.group, new Map());
    const groupAccounts = serviceRooms.get(req.group);

    const currentTime = Math.floor(Date.now() / 1000);
    bodyData.LastTime = currentTime; 
    groupAccounts.set(bodyData.Name, bodyData);

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
            finalOutput[val.Name] = val;
        }
    }

    return finalOutput;
}

app.listen(3000, () => {
    console.log('Meyy Hub API is running on port 3000! (｡◕‿◕｡)');
});
