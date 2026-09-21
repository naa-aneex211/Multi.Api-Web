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

app.use((req, res, next) => {
    const group = req.headers['x-group'];
    const timestamp = parseInt(req.headers['x-timestamp']);
    const signature = req.headers['x-signature'];

    if (!group || !timestamp || !signature) return res.status(401).send("Missing Headers");
    
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 15) return res.status(401).send("Expired Request"); // Quá 15s -> Spam -> Cút

    let dataToHash = timestamp.toString() + group;
    if (req.method === 'POST' && req.body) {
        dataToHash += (req.body.Name || "") + (req.body.IDK !== undefined ? req.body.IDK.toString() : "false");
    }

    const expectedSig = crypto.createHash('sha256').update(dataToHash + SECRET_KEY).digest('hex');
    if (signature !== expectedSig) return res.status(401).send("Invalid Signature"); // Sai chữ ký -> Phá hoại -> Cút

    req.group = group; // Gắn tên nhóm vào request
    next();
});
app.get('/api/party', (req, res) => {
    res.json(buildFinalOutput(req.group));
});

app.post('/api/party', (req, res) => {
    const { Name, IDK } = req.body;
    if (!Name) return res.status(400).send("Missing Name");

    if (!rooms.has(req.group)) rooms.set(req.group, new Map());
    const groupAccounts = rooms.get(req.group);

    const currentTime = Math.floor(Date.now() / 1000);
    groupAccounts.set(Name, { Name, LastTime: currentTime, IDK });

    res.json(buildFinalOutput(req.group));
});

function buildFinalOutput(group) {
    if (!rooms.has(group)) return {};
    const groupAccounts = rooms.get(group);
    const currentTime = Math.floor(Date.now() / 1000);
    let validList = [];

    // Lọc acc quá hạn 300s
    for (let [key, val] of groupAccounts.entries()) {
        if (currentTime - val.LastTime > 300) {
            groupAccounts.delete(key);
        } else {
            validList.push(val);
        }
    }

    // Sắp xếp theo LastTime y hệt script cũ
    validList.sort((a, b) => a.LastTime - b.LastTime);
    
    // Format thành dạng "acc 1", "acc 2"
    let finalOutput = {};
    validList.forEach((acc, i) => {
        finalOutput[`acc ${i + 1}`] = acc;
    });

    return finalOutput;
}

app.listen(3000, () => {
    console.log('Meyy Hub API is running on port 3000! (｡◕‿◕｡)');
});
