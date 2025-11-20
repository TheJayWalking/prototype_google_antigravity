const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Constants ---
const TILE_WIDTH = 320;
const TILE_HEIGHT = 320;
const GRAVITY = 0.5;
const JUMP_FORCE = -12;
const SPEED = 6;
let GRID_COLS = 3;
let GRID_ROWS = 2;

// --- Game State ---
let tiles = [];
let player = {
    x: 50, y: 50, width: 30, height: 30,
    vx: 0, vy: 0, grounded: false, color: '#00f2fe',
    idleTime: 0,
    idleAnimFrame: 0
};
let goal = { x: 0, y: 0, width: 40, height: 40, color: '#ffd700' };

// Drag & Drop State
let draggedTile = null;
let dragOffset = { x: 0, y: 0 };
let dragStartIndex = -1;
let hoverTargetIndex = -1; // For ghost tile
let isPaused = false;
let isGameOver = false;
let isTransitioning = false;

// Timer & Moves
let startTime = 0;
let elapsedTime = 0;
let movesLeft = 0;
const timerDisplay = document.getElementById('timer-display');
const levelDisplay = document.getElementById('level-display');
const movesDisplay = document.getElementById('moves-display');

// UI Elements
const modal = document.getElementById('game-over-modal');
const modalTitle = document.getElementById('game-over-title');
const modalMsg = document.getElementById('game-over-msg');
const continueBtn = document.getElementById('continue-btn');
const transitionOverlay = document.getElementById('transition-overlay');
const transitionText = document.getElementById('transition-text');

// Progression
let currentLevel = 1;

// Shake Effect
let shakeIntensity = 0;
let shakeDecay = 0.9;

// --- Input ---
const keys = {};

window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) > -1) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys[e.code] = false);

// Mouse Events
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
window.addEventListener('mouseup', onMouseUp);

document.getElementById('reset-btn').addEventListener('click', () => initLevel());
continueBtn.addEventListener('click', () => initLevel());

// --- Classes ---

class Tile {
    constructor(id, platforms, hazards = [], movingPlatforms = []) {
        this.id = id;
        this.platforms = platforms;
        this.hazards = hazards;
        this.movingPlatforms = movingPlatforms;

        this.color = (id % 2 === 0) ? '#2d2d2d' : '#353535';
        this.borderColor = '#444';

        this.x = 0;
        this.y = 0;
        this.targetX = 0;
        this.targetY = 0;

        this.isStart = false;
        this.isGoal = false;
        this.isLocked = false;
        this.shakeOffset = { x: 0, y: 0 };
    }

    roundRect(ctx, x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    update() {
        // Shake Decay
        if (Math.abs(this.shakeOffset.x) > 0.1 || Math.abs(this.shakeOffset.y) > 0.1) {
            this.shakeOffset.x *= 0.8;
            this.shakeOffset.y *= 0.8;
        } else {
            this.shakeOffset.x = 0;
            this.shakeOffset.y = 0;
        }

        // Smooth Snap (Lerp)
        if (this !== draggedTile) {
            this.x += (this.targetX - this.x) * 0.2;
            this.y += (this.targetY - this.y) * 0.2;

            // Snap if close enough to avoid micro-jitter
            if (Math.abs(this.x - this.targetX) < 0.5) this.x = this.targetX;
            if (Math.abs(this.y - this.targetY) < 0.5) this.y = this.targetY;
        }

        this.movingPlatforms.forEach(mp => {
            mp.x += mp.vx;
            mp.y += mp.vy;
            if (mp.vx > 0 && mp.x + mp.w >= mp.maxX || mp.vx < 0 && mp.x <= mp.minX) mp.vx *= -1;
            if (mp.vy > 0 && mp.y + mp.h >= mp.maxY || mp.vy < 0 && mp.y <= mp.minY) mp.vy *= -1;
        });
    }

    draw(ctx, isDragged, isGhost = false) {
        ctx.save();

        let drawX = this.x + this.shakeOffset.x;
        let drawY = this.y + this.shakeOffset.y;

        if (isGhost) {
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = '#4facfe';
            ctx.setLineDash([10, 5]);
        } else if (isDragged) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            ctx.shadowBlur = 20;
            ctx.shadowOffsetX = 10;
            ctx.shadowOffsetY = 10;
            ctx.globalAlpha = 0.9;
            // Scale up slightly when dragging
            ctx.translate(drawX + TILE_WIDTH / 2, drawY + TILE_HEIGHT / 2);
            ctx.scale(1.05, 1.05);
            ctx.translate(-(drawX + TILE_WIDTH / 2), -(drawY + TILE_HEIGHT / 2));
        }

        // Background
        ctx.fillStyle = this.color;
        this.roundRect(ctx, drawX + 5, drawY + 5, TILE_WIDTH - 10, TILE_HEIGHT - 10, 15);
        ctx.fill();

        // Border
        if (!isGhost) {
            if (this.isLocked) {
                ctx.strokeStyle = '#ffcc00'; // Gold border for locked
                ctx.lineWidth = 3;
            } else {
                ctx.strokeStyle = isDragged ? '#00f2fe' : this.borderColor;
                ctx.lineWidth = isDragged ? 3 : 1;
            }
            ctx.stroke();
        } else {
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Lock Icon (Simple visual)
        if (this.isLocked && !isGhost) {
            ctx.fillStyle = '#ffcc00';
            ctx.beginPath();
            ctx.arc(drawX + TILE_WIDTH - 20, drawY + 20, 8, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore(); // Restore shadow/transform/alpha

        // Platforms
        ctx.fillStyle = isGhost ? 'rgba(100,100,100,0.5)' : '#666';
        this.platforms.forEach(p => {
            this.roundRect(ctx, drawX + p.x, drawY + p.y, p.w, p.h, 5);
            ctx.fill();
        });

        // Moving Platforms
        ctx.fillStyle = isGhost ? 'rgba(79, 172, 254, 0.5)' : '#4facfe';
        this.movingPlatforms.forEach(p => {
            this.roundRect(ctx, drawX + p.x, drawY + p.y, p.w, p.h, 5);
            ctx.fill();
        });

        // Hazards
        ctx.fillStyle = isGhost ? 'rgba(255, 68, 68, 0.5)' : '#ff4444';
        this.hazards.forEach(h => {
            this.roundRect(ctx, drawX + h.x, drawY + h.y, h.w, h.h, 3);
            ctx.fill();
        });
    }
}

// --- Initialization ---

function initLevel() {
    tiles = [];
    isGameOver = false;
    isPaused = false;
    isTransitioning = false;
    modal.classList.add('hidden');
    transitionOverlay.classList.add('hidden');
    startTime = Date.now();
    elapsedTime = 0;

    levelDisplay.innerText = `LEVEL ${currentLevel}`;

    // Move Limits - 2 moves until level 10!
    if (currentLevel <= 10) {
        movesLeft = 2; // Levels 1-10: 2 moves only!
    } else if (currentLevel <= 15) {
        movesLeft = 3; // Levels 11-15: 3 moves
    } else {
        movesLeft = 4; // Levels 16+: 4 moves
    }

    movesDisplay.innerText = movesLeft;
    movesDisplay.parentElement.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
    movesDisplay.parentElement.style.boxShadow = '0 8px 30px rgba(245, 87, 108, 0.5)';

    // Dynamic Grid Size - Start at 3x2 for more fun
    if (currentLevel <= 5) {
        GRID_COLS = 3;
        GRID_ROWS = 2;
    } else {
        GRID_COLS = 4;
        GRID_ROWS = 2; // Cap at 4x2 for responsiveness
    }

    // Update Canvas Size
    canvas.width = GRID_COLS * TILE_WIDTH;
    canvas.height = GRID_ROWS * TILE_HEIGHT;

    const totalTiles = GRID_COLS * GRID_ROWS;

    // Define Tile Types - More Hazards for Fun! 🔥
    const safeTile = {
        type: 'safe',
        platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 50, y: 200, w: 100, h: 20 }],
        hazards: [
            { x: 150, y: 290, w: 100, h: 10 },
            { x: 0, y: 220, w: 40, h: 15 },
            { x: 280, y: 220, w: 40, h: 15 }
        ],
        moving: []
    };

    const safeTile2 = {
        type: 'safe',
        platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 180, y: 150, w: 100, h: 20 }],
        hazards: [
            { x: 50, y: 290, w: 80, h: 10 },
            { x: 100, y: 100, w: 60, h: 20 }
        ],
        moving: []
    };

    const hazardTile = {
        type: 'hazard',
        platforms: [{ x: 0, y: 200, w: 50, h: 20 }, { x: 270, y: 200, w: 50, h: 20 }],
        hazards: [
            { x: 0, y: 310, w: 320, h: 10 },
            { x: 60, y: 150, w: 30, h: 80 },
            { x: 230, y: 150, w: 30, h: 80 },
            { x: 120, y: 250, w: 80, h: 15 }
        ],
        moving: [{ x: 100, y: 200, w: 70, h: 20, vx: 2.5, vy: 0, minX: 60, maxX: 250, minY: 200, maxY: 200 }]
    };

    const movingTile = {
        type: 'moving',
        platforms: [{ x: 0, y: 300, w: 100, h: 20 }, { x: 220, y: 100, w: 100, h: 20 }],
        hazards: [
            { x: 120, y: 310, w: 80, h: 10 },
            { x: 140, y: 200, w: 40, h: 20 }
        ],
        moving: [
            { x: 130, y: 250, w: 60, h: 20, vx: 0, vy: -2, minX: 130, maxX: 130, minY: 100, maxY: 280 },
            { x: 50, y: 180, w: 50, h: 15, vx: 2, vy: 0, minX: 50, maxX: 220, minY: 180, maxY: 180 }
        ]
    };

    const complexTile = {
        type: 'complex',
        platforms: [{ x: 0, y: 300, w: 80, h: 20 }, { x: 120, y: 300, w: 80, h: 20 }, { x: 240, y: 300, w: 80, h: 20 }],
        hazards: [
            { x: 90, y: 150, w: 20, h: 100 },
            { x: 210, y: 50, w: 20, h: 100 },
            { x: 0, y: 250, w: 60, h: 15 },
            { x: 260, y: 250, w: 60, h: 15 }
        ],
        moving: []
    };

    const tunnelTile = {
        type: 'tunnel',
        platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 0, y: 0, w: 320, h: 50 }],
        hazards: [
            { x: 80, y: 290, w: 30, h: 10 },
            { x: 160, y: 290, w: 30, h: 10 },
            { x: 240, y: 290, w: 30, h: 10 },
            { x: 120, y: 150, w: 80, h: 20 }
        ],
        moving: []
    };

    const startTileDef = {
        type: 'start',
        platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 110, y: 200, w: 100, h: 20 }],
        hazards: [],
        moving: []
    };

    // 5 COMPLETELY DIFFERENT Goal Tile Layouts!
    const goalVariations = [
        // Variation 1: Classic center platform
        {
            type: 'goal',
            platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 110, y: 200, w: 100, h: 20 }],
            hazards: [
                { x: 0, y: 290, w: 100, h: 10 },
                { x: 220, y: 290, w: 100, h: 10 }
            ],
            moving: [
                { x: 200, y: 250, w: 50, h: 15, vx: 0, vy: -2, minX: 200, maxX: 200, minY: 100, maxY: 270 }
            ]
        },
        // Variation 2: Left-side platform
        {
            type: 'goal',
            platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 20, y: 180, w: 90, h: 20 }],
            hazards: [
                { x: 120, y: 290, w: 200, h: 10 },
                { x: 200, y: 100, w: 120, h: 25 }
            ],
            moving: [
                { x: 150, y: 220, w: 60, h: 15, vx: 2, vy: 0, minX: 120, maxX: 240, minY: 220, maxY: 220 }
            ]
        },
        // Variation 3: Right-side platform
        {
            type: 'goal',
            platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 210, y: 150, w: 90, h: 20 }],
            hazards: [
                { x: 0, y: 290, w: 200, h: 10 },
                { x: 0, y: 100, w: 120, h: 25 },
                { x: 140, y: 200, w: 60, h: 20 }
            ],
            moving: []
        },
        // Variation 4: High platform
        {
            type: 'goal',
            platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 120, y: 120, w: 80, h: 20 }],
            hazards: [
                { x: 50, y: 290, w: 100, h: 10 },
                { x: 170, y: 290, w: 100, h: 10 },
                { x: 0, y: 200, w: 100, h: 20 },
                { x: 220, y: 200, w: 100, h: 20 }
            ],
            moving: [
                { x: 40, y: 180, w: 50, h: 15, vx: 2, vy: -1, minX: 40, maxX: 230, minY: 140, maxY: 260 }
            ]
        },
        // Variation 5: Multi-platform stairs
        {
            type: 'goal',
            platforms: [
                { x: 0, y: 300, w: 320, h: 20 },
                { x: 10, y: 250, w: 70, h: 15 },
                { x: 125, y: 200, w: 70, h: 15 },
                { x: 240, y: 150, w: 70, h: 15 }
            ],
            hazards: [
                { x: 90, y: 290, w: 140, h: 10 },
                { x: 100, y: 100, w: 30, h: 80 }
            ],
            moving: [
                { x: 180, y: 220, w: 40, h: 15, vx: -2, vy: 0, minX: 90, maxX: 220, minY: 220, maxY: 220 }
            ]
        }
    ];

    // Use level number to cycle through completely different layouts
    const goalTileDef = goalVariations[(currentLevel - 1) % goalVariations.length];

    const connectorLow = { type: 'safe', platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 0, y: 250, w: 100, h: 20 }, { x: 220, y: 250, w: 100, h: 20 }], hazards: [], moving: [] };
    const connectorHigh = { type: 'safe', platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 110, y: 100, w: 100, h: 20 }], hazards: [], moving: [] };
    const connectorStairs = { type: 'safe', platforms: [{ x: 0, y: 300, w: 320, h: 20 }, { x: 0, y: 250, w: 80, h: 20 }, { x: 120, y: 180, w: 80, h: 20 }, { x: 240, y: 110, w: 80, h: 20 }], hazards: [], moving: [] };

    let pool = [];

    // Difficulty Progression
    if (currentLevel === 1) {
        // Level 1: Still has hazards but easier mix
        const dangerPool = [hazardTile, movingTile, complexTile, tunnelTile];
        const safePool = [safeTile, safeTile2, connectorLow, connectorHigh, connectorStairs];

        const slotsNeeded = totalTiles - 2;

        // Level 1: More safe tiles but still some hazards!
        for (let i = 0; i < slotsNeeded; i++) {
            if (Math.random() > 0.6) { // 40% chance of danger (easier than other levels)
                pool.push(dangerPool[Math.floor(Math.random() * dangerPool.length)]);
            } else {
                pool.push(safePool[Math.floor(Math.random() * safePool.length)]);
            }
        }
    } else {
        // Level 2+: More challenging mix
        const dangerPool = [hazardTile, movingTile, complexTile, tunnelTile];
        const safePool = [safeTile, safeTile2, connectorLow, connectorHigh, connectorStairs];

        const slotsNeeded = totalTiles - 2;
        let slotsFilled = 0;

        // Smart Pool: Guarantee Connectors if space permits
        if (slotsNeeded >= 3) {
            pool.push(connectorLow);
            pool.push(connectorHigh);
            pool.push(connectorStairs);
            slotsFilled += 3;
        } else if (slotsNeeded >= 2) {
            pool.push(connectorStairs);
            pool.push(connectorLow);
            slotsFilled += 2;
        } else if (slotsNeeded >= 1) {
            pool.push(connectorStairs);
            slotsFilled += 1;
        }

        // Fill remaining slots - More hazards!
        for (let i = slotsFilled; i < slotsNeeded; i++) {
            if (Math.random() > 0.3) { // 70% chance of danger for more fun!
                pool.push(dangerPool[Math.floor(Math.random() * dangerPool.length)]);
            } else {
                pool.push(safePool[Math.floor(Math.random() * safePool.length)]);
            }
        }
    }

    // Smart Spawning: Ensure Start and Goal are FAR apart for challenge
    let finalLayouts = [];
    let isValid = false;
    let attempts = 0;

    while (!isValid && attempts < 100) {
        finalLayouts = [startTileDef, goalTileDef, ...pool];
        finalLayouts.sort(() => Math.random() - 0.5);

        const startIndex = finalLayouts.indexOf(startTileDef);
        const goalIndex = finalLayouts.indexOf(goalTileDef);

        const startCol = startIndex % GRID_COLS;
        const startRow = Math.floor(startIndex / GRID_COLS);
        const goalCol = goalIndex % GRID_COLS;
        const goalRow = Math.floor(goalIndex / GRID_COLS);

        const dist = Math.abs(startCol - goalCol) + Math.abs(startRow - goalRow);

        // Min distance: 3 for more challenge (was 2)
        if (dist >= 3) {
            isValid = true;
        }
        attempts++;
    }

    for (let i = 0; i < totalTiles; i++) {
        const l = finalLayouts[i];
        const t = new Tile(i, l.platforms, l.hazards, JSON.parse(JSON.stringify(l.moving)));

        // Mark special tiles
        if (l.type === 'start') {
            t.isStart = true;
            t.isLocked = true; // Lock Start
        }
        if (l.type === 'goal') {
            t.isGoal = true;
            t.isLocked = true; // Lock Goal
        }

        // Visual distinction
        if (t.isStart) t.color = '#808080'; // Grey
        if (t.isGoal) t.color = '#808080'; // Grey (Same as Start)

        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        t.x = col * TILE_WIDTH;
        t.y = row * TILE_HEIGHT;
        t.targetX = t.x;
        t.targetY = t.y;
        tiles.push(t);
    }

    // Locate Start and Goal
    const startT = tiles.find(t => t.isStart);
    const goalT = tiles.find(t => t.isGoal);

    // Spawn Player at Start Tile
    // Center of the platform on start tile (x: 110, y: 200, w: 100)
    player.x = startT.x + 110 + 35; // Center on platform
    player.y = startT.y + 200 - 40; // Above platform
    player.vx = 0;
    player.vy = 0;

    // Set Goal Position
    // Center of the platform on goal tile (x: 110, y: 200, w: 100)
    goal.x = goalT.x + 110 + 30;
    goal.y = goalT.y + 200 - 40;
}

function levelComplete() {
    if (isTransitioning) return;
    isTransitioning = true;
    isGameOver = true; // Stop input
    shakeScreen(10);

    // Seamless Transition
    transitionOverlay.classList.remove('hidden');
    transitionOverlay.style.opacity = 1;
    transitionText.innerText = `LEVEL ${currentLevel} COMPLETE`;

    setTimeout(() => {
        currentLevel++;
        initLevel();
        setTimeout(() => {
            transitionOverlay.style.opacity = 0;
            setTimeout(() => {
                transitionOverlay.classList.add('hidden');
            }, 500);
        }, 200);
    }, 1500);
}


function gameOver(won) {
    if (won) {
        levelComplete();
    } else {
        isGameOver = true;
        shakeScreen(20);
        modalTitle.innerText = movesLeft <= 0 ? "OUT OF MOVES" : "GAME OVER";
        modalTitle.style.color = "#ff4444";
        modalMsg.innerText = movesLeft <= 0 ? "You ran out of moves!" : "You hit a hazard or fell!";
        continueBtn.innerText = "Try Again";
        setTimeout(() => {
            modal.classList.remove('hidden');
        }, 500);
    }
}

function shakeScreen(intensity) {
    shakeIntensity = intensity;
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius, color) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
}

// --- Drag & Drop Logic ---

function onMouseDown(e) {
    if (isGameOver || isTransitioning) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        // Check against current visual position (t.x, t.y)
        if (mouseX >= t.x && mouseX <= t.x + TILE_WIDTH &&
            mouseY >= t.y && mouseY <= t.y + TILE_HEIGHT) {

            if (t.isLocked) {
                t.shakeOffset = { x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20 };
                return;
            }

            if (movesLeft <= 0) {
                shakeScreen(5);
                return;
            }

            draggedTile = t;
            dragStartIndex = i;
            dragOffset.x = mouseX - t.x;
            dragOffset.y = mouseY - t.y;
            isPaused = true;
            return;
        }
    }
}

function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Cursor Logic
    let cursor = 'default';
    for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (mouseX >= t.x && mouseX <= t.x + TILE_WIDTH &&
            mouseY >= t.y && mouseY <= t.y + TILE_HEIGHT) {
            if (t.isLocked) cursor = 'not-allowed';
            else cursor = 'grab';
            break;
        }
    }
    if (draggedTile) cursor = 'grabbing';
    canvas.style.cursor = cursor;

    if (!draggedTile) return;

    const prevX = draggedTile.x;
    const prevY = draggedTile.y;

    draggedTile.x = mouseX - dragOffset.x;
    draggedTile.y = mouseY - dragOffset.y;

    // Calculate Hover Target for Ghost Tile
    const col = Math.floor((draggedTile.x + TILE_WIDTH / 2) / TILE_WIDTH);
    const row = Math.floor((draggedTile.y + TILE_HEIGHT / 2) / TILE_HEIGHT);
    const safeCol = Math.max(0, Math.min(GRID_COLS - 1, col));
    const safeRow = Math.max(0, Math.min(GRID_ROWS - 1, row));
    hoverTargetIndex = safeRow * GRID_COLS + safeCol;


    // Player Follow
    const diffX = draggedTile.x - prevX;
    const diffY = draggedTile.y - prevY;
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;

    if (playerCenterX > prevX && playerCenterX < prevX + TILE_WIDTH &&
        playerCenterY > prevY && playerCenterY < prevY + TILE_HEIGHT) {
        player.x += diffX;
        player.y += diffY;
    }
}

function onMouseUp(e) {
    if (!draggedTile) return;

    const col = Math.floor((draggedTile.x + TILE_WIDTH / 2) / TILE_WIDTH);
    const row = Math.floor((draggedTile.y + TILE_HEIGHT / 2) / TILE_HEIGHT);
    const safeCol = Math.max(0, Math.min(GRID_COLS - 1, col));
    const safeRow = Math.max(0, Math.min(GRID_ROWS - 1, row));
    const targetIndex = safeRow * GRID_COLS + safeCol;

    // Player Follow Snap Logic
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    const isPlayerOnTile = (playerCenterX > draggedTile.x && playerCenterX < draggedTile.x + TILE_WIDTH &&
        playerCenterY > draggedTile.y && playerCenterY < draggedTile.y + TILE_HEIGHT);

    const relX = player.x - draggedTile.x;
    const relY = player.y - draggedTile.y;

    // Swap Logic
    if (targetIndex !== dragStartIndex && targetIndex >= 0 && targetIndex < tiles.length) {
        const targetTile = tiles[targetIndex];
        tiles[targetIndex] = draggedTile;
        tiles[dragStartIndex] = targetTile;

        // Decrement Moves
        movesLeft--;
        movesDisplay.innerText = movesLeft;

        // Add pulse animation
        movesDisplay.classList.add('move-used');
        setTimeout(() => movesDisplay.classList.remove('move-used'), 400);

        // Visual feedback based on remaining moves
        if (movesLeft <= 0) {
            movesDisplay.parentElement.style.background = 'linear-gradient(135deg, #ff4444 0%, #cc0000 100%)';
            movesDisplay.parentElement.style.boxShadow = '0 8px 30px rgba(255, 68, 68, 0.8)';
            shakeScreen(10);
        } else if (movesLeft <= 2) {
            // Warning state - orange/yellow
            movesDisplay.parentElement.style.background = 'linear-gradient(135deg, #f5af19 0%, #f12711 100%)';
            movesDisplay.parentElement.style.boxShadow = '0 8px 30px rgba(241, 39, 17, 0.6)';
        }
    }

    // Set Targets for Smooth Snap
    snapTilesToGrid();

    // If player was on the tile, snap them too (relative to the NEW target position of the tile)
    if (isPlayerOnTile) {
        player.x = draggedTile.targetX + relX;
        player.y = draggedTile.targetY + relY;
    }

    draggedTile = null;
    dragStartIndex = -1;
    hoverTargetIndex = -1;
    isPaused = false;
}

function snapTilesToGrid() {
    for (let i = 0; i < tiles.length; i++) {
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        // Set TARGET, not current X/Y
        tiles[i].targetX = col * TILE_WIDTH;
        tiles[i].targetY = row * TILE_HEIGHT;
    }
}

// --- Physics & Update ---

function checkAABB(rect1, rect2) {
    return (rect1.x < rect2.x + rect2.w &&
        rect1.x + rect1.w > rect2.x &&
        rect1.y < rect2.y + rect2.h &&
        rect1.y + rect1.h > rect2.y);
}

function update() {
    if (shakeIntensity > 0) {
        shakeIntensity -= shakeDecay;
        if (shakeIntensity < 0) shakeIntensity = 0;
    }

    if (isGameOver) return;

    if (!isPaused) {
        elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        timerDisplay.innerText = `Time: ${elapsedTime}s`;
    }

    tiles.forEach(t => t.update());

    // Sync Goal Position with Goal Tile
    const goalT = tiles.find(t => t.isGoal);
    if (goalT) {
        goal.x = goalT.x + 110 + 30;
        goal.y = goalT.y + 200 - 40;
    }

    if (isPaused) return;

    // Idle Animation Logic
    if (player.vx === 0 && player.grounded) {
        player.idleTime++;
    } else {
        player.idleTime = 0;
        player.idleAnimFrame = 0;
    }

    // Controls
    if (keys['ArrowLeft'] || keys['KeyA']) {
        player.vx = -SPEED;
    } else if (keys['ArrowRight'] || keys['KeyD']) {
        player.vx = SPEED;
    } else {
        player.vx = 0;
    }

    if ((keys['Space'] || keys['ArrowUp'] || keys['KeyW']) && player.grounded) {
        player.vy = JUMP_FORCE;
        player.grounded = false;
    }

    player.vy += GRAVITY;
    player.x += player.vx;
    player.y += player.vy;

    // Bounds
    if (player.y > canvas.height) {
        gameOver(false);
        return;
    }
    if (player.x < 0) player.x = 0;
    if (player.x + player.width > canvas.width) player.x = canvas.width - player.width;

    player.grounded = false;

    for (const tile of tiles) {

        for (const h of tile.hazards) {
            const hRect = { x: tile.x + h.x, y: tile.y + h.y, w: h.w, h: h.h };
            if (checkAABB({ x: player.x, y: player.y, w: player.width, h: player.height }, hRect)) {
                gameOver(false);
                return;
            }
        }

        const allPlatforms = [...tile.platforms, ...tile.movingPlatforms];

        for (const p of allPlatforms) {
            const pRect = { x: tile.x + p.x, y: tile.y + p.y, w: p.w, h: p.h };

            if (checkAABB({ x: player.x, y: player.y, w: player.width, h: player.height }, pRect)) {
                const overlapX = (player.x + player.width / 2) - (pRect.x + pRect.w / 2);
                const overlapY = (player.y + player.height / 2) - (pRect.y + pRect.h / 2);
                const ox = (player.width / 2) + (pRect.w / 2) - Math.abs(overlapX);
                const oy = (player.height / 2) + (pRect.h / 2) - Math.abs(overlapY);

                if (ox < oy) {
                    if (overlapX > 0) player.x += ox;
                    else player.x -= ox;
                    player.vx = 0;
                } else {
                    if (overlapY > 0) {
                        player.y += oy;
                        player.vy = 0;
                    } else {
                        player.y -= oy;
                        player.vy = 0;
                        player.grounded = true;
                        if (p.vx) {
                            player.x += p.vx;
                            if (p.vy) player.y += p.vy;
                        }
                    }
                }
            }
        }
    }

    if (checkAABB({ x: player.x, y: player.y, w: player.width, h: player.height },
        { x: goal.x, y: goal.y, w: goal.width, h: goal.height })) {
        gameOver(true);
    }
}

function draw() {
    ctx.save();

    if (shakeIntensity > 0) {
        const dx = (Math.random() - 0.5) * shakeIntensity;
        const dy = (Math.random() - 0.5) * shakeIntensity;
        ctx.translate(dx, dy);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Ghost Tile
    if (draggedTile && hoverTargetIndex !== -1) {
        const col = hoverTargetIndex % GRID_COLS;
        const row = Math.floor(hoverTargetIndex / GRID_COLS);
        const ghostX = col * TILE_WIDTH;
        const ghostY = row * TILE_HEIGHT;

        // Create a temp ghost tile to draw
        const ghost = new Tile(999, draggedTile.platforms, draggedTile.hazards, draggedTile.movingPlatforms);
        ghost.x = ghostX;
        ghost.y = ghostY;
        ghost.draw(ctx, false, true); // isGhost = true
    }

    tiles.forEach(t => {
        if (t !== draggedTile) t.draw(ctx, false);
    });

    if (draggedTile) {
        draggedTile.draw(ctx, true);
    }

    // Draw Goal Star
    drawStar(ctx, goal.x + goal.width / 2, goal.y + goal.height / 2, 5, 25, 12, goal.color);

    // Draw Player as Cute Cat Emoji with Idle Animation
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Idle animation: gentle bobbing and expression changes
    let catEmoji = '🐱';
    let yOffset = 0;

    if (player.idleTime > 30) { // Start idle animation after 0.5 seconds of being still
        // Gentle bobbing motion
        yOffset = Math.sin(player.idleTime * 0.1) * 2;

        // Alternate between normal and winking cat every 2 seconds
        if (Math.floor(player.idleTime / 120) % 2 === 1) {
            catEmoji = '😺'; // Smiling cat
        }
    }

    ctx.fillText(catEmoji, player.x + player.width / 2, player.y + player.height / 2 + yOffset);

    if (isPaused) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '20px Arial';
        ctx.fillText("TIME FROZEN", 10, 30);
    }

    ctx.restore();
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

// Start immediately
initLevel();
loop();
