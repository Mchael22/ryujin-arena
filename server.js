const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

const ROOM_SIZE = 5000; 
let players = {};
let foods = [];
let mapCoins = []; 

for (let i = 0; i < 300; i++) genFood(false); 
for (let i = 0; i < 80; i++) genFood(true);   
for (let i = 0; i < 100; i++) genCoin();       

function genFood(isBig = false, customX = null, customY = null) {
    foods.push({
        id: Math.random(),
        x: customX !== null ? customX : Math.floor(Math.random() * (ROOM_SIZE - 40)) + 20,
        y: customY !== null ? customY : Math.floor(Math.random() * (ROOM_SIZE - 40)) + 20,
        score: isBig ? 30 : 10,
        isBig: isBig
    });
}

function genCoin() {
    mapCoins.push({
        id: Math.random(),
        x: Math.floor(Math.random() * (ROOM_SIZE - 40)) + 20,
        y: Math.floor(Math.random() * (ROOM_SIZE - 40)) + 20,
        value: Math.floor(Math.random() * 5) + 1 
    });
}

const BOT_NAMES = ["Orochi", "Ryu", "Tengu", "Yokai", "Shinigami", "Kitsune", "Oni", "Susanoo"];

function spawnBot() {
    let id = 'bot_' + Math.random();
    let isBig = Math.random() > 0.6; 
    let startScore = isBig ? Math.floor(Math.random() * 4000) + 1000 : Math.floor(Math.random() * 600) + 50;
    
    players[id] = {
        id: id,
        name: "[BOT] " + BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
        color: '#' + Math.floor(Math.random()*16777215).toString(16),
        skin: 'default',
        segments: [{x: Math.random() * (ROOM_SIZE-200) + 100, y: Math.random() * (ROOM_SIZE-200) + 100}],
        angle: Math.random() * Math.PI * 2,
        score: startScore,
        collectedCoins: 0,
        isBoosting: false,
        isBot: true 
    };
    for(let i=1; i<8; i++) { players[id].segments.push({...players[id].segments[0]}); }
}

for(let i=0; i<15; i++) spawnBot();

io.on('connection', (socket) => {
    socket.on('join-game', (data) => {
        players[socket.id] = {
            id: socket.id,
            name: data.name || 'Ronin',
            color: data.color || '#ffffff',
            skin: data.skin || 'default',
            segments: [{x: Math.random() * (ROOM_SIZE-200) + 100, y: Math.random() * (ROOM_SIZE-200) + 100}],
            angle: 0,
            score: 0,
            collectedCoins: 0,
            isBoosting: false,
            isBot: false
        };
        for(let i=1; i<8; i++) { players[socket.id].segments.push({...players[socket.id].segments[0]}); }
        socket.emit('init', { roomSize: ROOM_SIZE });
    });

    socket.on('update-input', (data) => {
        if (players[socket.id] && !players[socket.id].isBot) {
            players[socket.id].angle = data.angle;
            players[socket.id].isBoosting = data.isBoosting && players[socket.id].score > 20;
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; });
});

// Helper matematika cepat (menghindari Math.hypot yang berat)
function distSq(x1, y1, x2, y2) {
    let dx = x1 - x2; let dy = y1 - y2; return dx * dx + dy * dy;
}

// Game Loop (60 FPS)
setInterval(() => {
    Object.keys(players).forEach(id => {
        let p = players[id];
        let head = p.segments[0];

        if (p.isBot) {
            let targetX = null, targetY = null;
            let minDistSq = 700 * 700; 
            p.isBoosting = false;

            Object.values(players).forEach(other => {
                if (other.id !== p.id) {
                    let dSq = distSq(head.x, head.y, other.segments[0].x, other.segments[0].y);
                    if (dSq < minDistSq) {
                        if (other.score < p.score) { 
                            targetX = other.segments[0].x; targetY = other.segments[0].y;
                            minDistSq = dSq;
                            if (dSq < 90000 && p.score > 100) p.isBoosting = true; // 300^2
                        } else {
                            targetX = head.x - (other.segments[0].x - head.x); 
                            targetY = head.y - (other.segments[0].y - head.y);
                            minDistSq = dSq;
                            if (dSq < 62500) p.isBoosting = true; // 250^2
                        }
                    }
                }
            });

            if (targetX === null) {
                let fDistSq = 800 * 800;
                foods.forEach(f => {
                    let dSq = distSq(head.x, head.y, f.x, f.y);
                    if (dSq < fDistSq) { fDistSq = dSq; targetX = f.x; targetY = f.y; }
                });
            }

            if (targetX !== null && targetY !== null) {
                let desiredAngle = Math.atan2(targetY - head.y, targetX - head.x);
                let diff = desiredAngle - p.angle;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                p.angle += diff * 0.08; 
            } else {
                p.angle += (Math.random() - 0.5) * 0.1; 
            }
        }

        let speed = p.isBoosting ? 8 : 4;
        let newHead = { x: head.x + Math.cos(p.angle) * speed, y: head.y + Math.sin(p.angle) * speed };

        if (newHead.x < 10 || newHead.x > ROOM_SIZE - 10 || newHead.y < 10 || newHead.y > ROOM_SIZE - 10) {
            if(p.isBot) p.angle += Math.PI; 
            newHead.x = Math.max(10, Math.min(newHead.x, ROOM_SIZE - 10));
            newHead.y = Math.max(10, Math.min(newHead.y, ROOM_SIZE - 10));
        }

        p.segments.unshift(newHead);
        
        if (p.isBoosting && Math.random() < 0.15) {
            p.score -= 2;
            if (p.segments.length > 2) p.segments.pop(); 
            genFood(false, head.x - Math.cos(p.angle)*30, head.y - Math.sin(p.angle)*30);
            if (p.score < 20) p.isBoosting = false;
        }

        let ate = false;
        let snakeSize = 10 + Math.min(p.score / 60, 40);

        foods = foods.filter(f => {
            let eatRadius = snakeSize + (f.isBig ? 15 : 8);
            if (distSq(newHead.x, newHead.y, f.x, f.y) < eatRadius * eatRadius) {
                ate = true; p.score += f.score; genFood(f.isBig); return false;
            }
            return true;
        });

        mapCoins = mapCoins.filter(c => {
            let coinRadius = snakeSize + 10;
            if (distSq(newHead.x, newHead.y, c.x, c.y) < coinRadius * coinRadius) {
                p.collectedCoins += c.value; genCoin(); return false;
            }
            return true;
        });

        if (!ate) p.segments.pop();
    });

    Object.keys(players).forEach(idA => {
        Object.keys(players).forEach(idB => {
            if (idA === idB || !players[idA] || !players[idB]) return;
            let snakeA = players[idA], snakeB = players[idB];
            let headA = snakeA.segments[0], sizeB = 10 + Math.min(snakeB.score / 60, 40);

            // Bounding box kasar untuk menghindari looping jika ular saling berjauhan
            let dx = headA.x - snakeB.segments[0].x;
            let dy = headA.y - snakeB.segments[0].y;
            if (dx*dx + dy*dy > 400000) return; // Lewati jika jarak sangat jauh

            for (let i = 0; i < snakeB.segments.length; i++) {
                if (i === 0) {
                    if (distSq(headA.x, headA.y, snakeB.segments[0].x, snakeB.segments[0].y) < 225) { // 15^2
                        let loser = snakeA.score <= snakeB.score ? idA : idB;
                        killSnake(loser); break;
                    }
                    continue;
                }
                let hitRad = sizeB + 5;
                if (distSq(headA.x, headA.y, snakeB.segments[i].x, snakeB.segments[i].y) < hitRad * hitRad) {
                    killSnake(idA); break;
                }
            }
        });
    });

    io.emit('update-game', { players, foods, mapCoins });
}, 1000 / 60);

function killSnake(id) {
    if (!players[id]) return;
    let p = players[id];
    let isBot = p.isBot;
    
    p.segments.forEach((seg, idx) => {
        if (idx % 2 === 0) genFood(true, seg.x + (Math.random()*20-10), seg.y + (Math.random()*20-10));
    });

    if (!isBot) {
        io.to(id).emit('game-over', { finalScore: Math.floor(p.score), mapCoinsCollected: p.collectedCoins });
    }
    delete players[id];

    if (isBot) setTimeout(() => spawnBot(), 2000);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });