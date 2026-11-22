// ar_xp_apps.js — Windows XP Application Suite for AR Screens
// Contains self-contained, offline-ready HTML/CSS/JS generators for:
// Calculator, Notepad, Paint, Minesweeper, Calendar, Windows Media Player,
// Internet Explorer, YouTube, Google Maps, My Computer, Recycle Bin, and Full XP Desktop.

export function getCommonXpStyles() {
    return `
        :root {
            --xp-blue: #0058EE;
            --xp-blue-dark: #0022AA;
            --xp-border: #0054E3;
            --xp-bg: #ECE9D8;
            --xp-text: #000000;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body, html {
            width: 100%; height: 100%; overflow: hidden;
            font-family: 'Tahoma', 'Segoe UI', Arial, sans-serif;
            background-color: #ECE9D8; color: #000;
            user-select: none; -webkit-user-select: none;
        }
        .app-window {
            display: flex; flex-direction: column;
            width: 100%; height: 100%;
            background-color: #ECE9D8;
            border: 1px solid #0054E3;
            overflow: hidden;
        }
        .app-window-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 4px 0 8px; height: 32px; min-height: 32px;
            background: linear-gradient(to right, #0058E6 0%, #3A93FF 60%, #0058E6 100%);
            color: white; user-select: none;
        }
        .app-window-header-left {
            display: flex; align-items: center; gap: 8px;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .app-window-icon {
            width: 16px; height: 16px; object-fit: contain;
        }
        .app-window-title {
            margin: 0; font-size: 13px; font-weight: bold;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.7);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .app-window-controls {
            display: flex; align-items: center; gap: 4px; padding-right: 2px;
        }
        .app-window-btn {
            width: 22px; height: 22px; border: 1px solid white;
            border-radius: 3px; display: flex; align-items: center;
            justify-content: center; cursor: pointer; color: white;
            font-size: 13px; font-weight: bold; line-height: 1;
            box-shadow: 0 1px 2px rgba(0,0,0,0.3);
            position: relative;
        }
        .btn-min, .btn-max { background: #7BB3F0; }
        .btn-min:hover, .btn-max:hover { background: #92C1F5; }
        /* Large high-accuracy touch hitbox for the close button */
        .btn-close {
            width: 32px; height: 26px;
            background: #C75050;
            font-size: 18px;
            font-weight: 900;
        }
        .btn-close::before {
            content: '';
            position: absolute;
            top: -10px; bottom: -10px; left: -10px; right: -10px;
        }
        .btn-close:hover, .btn-close:active { background: #E45A5A; }
        .app-window-content {
            flex: 1; height: calc(100% - 32px); overflow: hidden;
            display: flex; flex-direction: column; background: #ECE9D8;
        }
    `;
}

// Helper to wrap any app content inside the standard Windows XP AppWindow shell
export function wrapInAppWindow(title, iconPath, contentHtml, extraCss = '', screenId = '0') {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        ${getCommonXpStyles()}
        ${extraCss}
    </style>
</head>
<body>
    <div class="app-window">
        <div class="app-window-header" style="cursor: move;">
            <div class="app-window-header-left">
                <img class="app-window-icon" src="${iconPath}" alt="icon" onerror="this.style.display='none'">
                <h3 class="app-window-title">${title}</h3>
            </div>
            <div class="app-window-controls">
                <button class="app-window-btn btn-min" title="Minimize">–</button>
                <button class="app-window-btn btn-max" title="Maximize">◻</button>
                <button class="app-window-btn btn-close" title="Close" onclick="closeThisScreen()">×</button>
            </div>
        </div>
        <div class="app-window-content">
            ${contentHtml}
        </div>
    </div>
    <script>
        function closeThisScreen() {
            window.parent.postMessage({ action: 'closeScreen', screenId: '${screenId}' }, '*');
        }

        // Top bar draggable - communicates screen-relative movement to parent AR window
        (function() {
            const header = document.querySelector('.app-window-header');
            if (!header) return;
            header.style.touchAction = 'none';

            let isDragging = false;
            let lastScreenX = 0;
            let lastScreenY = 0;

            function getCoord(e) {
                if (e.touches && e.touches.length > 0) {
                    const t = e.touches[0];
                    return {
                        x: (t.screenX !== undefined && t.screenX !== 0) ? t.screenX : t.clientX,
                        y: (t.screenY !== undefined && t.screenY !== 0) ? t.screenY : t.clientY
                    };
                }
                return {
                    x: (e.screenX !== undefined && e.screenX !== 0) ? e.screenX : e.clientX,
                    y: (e.screenY !== undefined && e.screenY !== 0) ? e.screenY : e.clientY
                };
            }

            function onStart(e) {
                if (e.target.closest('.app-window-controls')) return;
                const pos = getCoord(e);
                isDragging = true;
                lastScreenX = pos.x;
                lastScreenY = pos.y;
                window.parent.postMessage({ action: 'dragStart', screenId: '${screenId}' }, '*');
            }

            function onMove(e) {
                if (!isDragging) return;
                const pos = getCoord(e);
                if (lastScreenX === 0 && lastScreenY === 0) {
                    lastScreenX = pos.x;
                    lastScreenY = pos.y;
                    return;
                }
                const dx = pos.x - lastScreenX;
                const dy = pos.y - lastScreenY;
                if (dx === 0 && dy === 0) return;
                lastScreenX = pos.x;
                lastScreenY = pos.y;
                window.parent.postMessage({
                    action: 'dragMove',
                    screenId: '${screenId}',
                    dx: dx,
                    dy: dy
                }, '*');
            }

            function onEnd() {
                if (isDragging) {
                    isDragging = false;
                    lastScreenX = 0;
                    lastScreenY = 0;
                    window.parent.postMessage({ action: 'dragEnd', screenId: '${screenId}' }, '*');
                }
            }

            header.addEventListener('touchstart', onStart, { passive: true });
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('touchend', onEnd, { passive: true });
            window.addEventListener('touchcancel', onEnd, { passive: true });

            header.addEventListener('mousedown', onStart);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onEnd);
        })();
    </script>
</body>
</html>`;
}

// ── 1. CALCULATOR ─────────────────────────────────────────────────────────────
export function getCalculatorHtml(screenId = '0') {
    const css = `
        .calc-box {
            display: flex; flex-direction: column; height: 100%;
            padding: 12px; gap: 10px; font-family: Tahoma, sans-serif;
        }
        .calc-screen {
            background: #fff; border: 1px solid #7F9DB9; border-radius: 3px;
            height: 48px; padding: 6px 12px; display: flex; align-items: center;
            justify-content: flex-end; font-size: 26px; font-family: 'Consolas', monospace;
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;
        }
        .calc-grid {
            display: grid; grid-template-columns: repeat(4, 1fr);
            gap: 8px; flex: 1;
        }
        .calc-btn {
            border: 1px solid #ACA899; border-radius: 4px;
            background: linear-gradient(to bottom, #fafafa, #e3e3e3);
            font-size: 18px; font-weight: bold; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 1px 2px rgba(0,0,0,0.15);
            transition: all 0.08s ease;
        }
        .calc-btn:hover { background: linear-gradient(to bottom, #ffffff, #ececec); }
        .calc-btn:active { transform: translateY(1px); background: #d0d0d0; box-shadow: inset 0 1px 2px rgba(0,0,0,0.2); }
        .calc-op { background: linear-gradient(to bottom, #95c5ee, #5d98d4); color: white; }
        .calc-op:hover { background: linear-gradient(to bottom, #abd4f7, #6ea3dc); }
        .calc-clear { background: linear-gradient(to bottom, #ff9191, #e57373); color: white; }
        .calc-clear:hover { background: linear-gradient(to bottom, #ffa6a6, #ec8282); }
    `;
    const html = `
        <div class="calc-box">
            <div class="calc-screen" id="disp">0</div>
            <div class="calc-grid">
                <button class="calc-btn calc-clear" onclick="clk('C')">C</button>
                <button class="calc-btn calc-clear" onclick="clk('CE')">CE</button>
                <button class="calc-btn calc-op" onclick="clk('DEL')">←</button>
                <button class="calc-btn calc-op" onclick="clk('/')">÷</button>
                <button class="calc-btn" onclick="clk('7')">7</button>
                <button class="calc-btn" onclick="clk('8')">8</button>
                <button class="calc-btn" onclick="clk('9')">9</button>
                <button class="calc-btn calc-op" onclick="clk('*')">×</button>
                <button class="calc-btn" onclick="clk('4')">4</button>
                <button class="calc-btn" onclick="clk('5')">5</button>
                <button class="calc-btn" onclick="clk('6')">6</button>
                <button class="calc-btn calc-op" onclick="clk('-')">−</button>
                <button class="calc-btn" onclick="clk('1')">1</button>
                <button class="calc-btn" onclick="clk('2')">2</button>
                <button class="calc-btn" onclick="clk('3')">3</button>
                <button class="calc-btn calc-op" onclick="clk('+')">+</button>
                <button class="calc-btn" onclick="clk('0')">0</button>
                <button class="calc-btn" onclick="clk('.')">.</button>
                <button class="calc-btn" onclick="clk('±')">±</button>
                <button class="calc-btn calc-op" style="background: linear-gradient(to bottom, #50b050, #388e3c);" onclick="clk('=')">=</button>
            </div>
        </div>
        <script>
            let val = '0', op = null, prev = null, wait = false;
            const d = document.getElementById('disp');
            function clk(b) {
                if ('0123456789.'.includes(b)) {
                    if (wait) { val = b === '.' ? '0.' : b; wait = false; }
                    else { if (b === '.' && val.includes('.')) return; val = (val === '0' && b !== '.') ? b : val + b; }
                    d.textContent = val;
                } else if (b === 'C') { val = '0'; op = null; prev = null; wait = false; d.textContent = '0'; }
                else if (b === 'CE') { val = '0'; d.textContent = '0'; }
                else if (b === 'DEL') { val = val.length > 1 ? val.slice(0, -1) : '0'; d.textContent = val; }
                else if (b === '±') { val = String(-parseFloat(val)); d.textContent = val; }
                else if ('+-*/'.includes(b)) {
                    const curr = parseFloat(val);
                    if (prev === null) prev = curr;
                    else if (op && !wait) { prev = calc(op, prev, curr); d.textContent = String(prev); }
                    wait = true; op = b;
                } else if (b === '=') {
                    if (op && prev !== null) {
                        const res = calc(op, prev, parseFloat(val));
                        val = String(res); prev = null; op = null; wait = true;
                        d.textContent = val;
                    }
                }
            }
            function calc(o, a, b) {
                if (o === '+') return a + b;
                if (o === '-') return a - b;
                if (o === '*') return a * b;
                if (o === '/') return b !== 0 ? a / b : 'Error';
                return b;
            }
        </script>
    `;
    return wrapInAppWindow('Calculator', 'images/icons/calculator.png', html, css, screenId);
}

// ── 2. NOTEPAD ────────────────────────────────────────────────────────────────
export function getNotepadHtml(screenId = '0') {
    const css = `
        .notepad-box { display: flex; flex-direction: column; height: 100%; }
        .notepad-menu {
            display: flex; gap: 8px; padding: 3px 8px; background: #ECE9D8;
            border-bottom: 1px solid #ACA899; font-size: 11px;
        }
        .notepad-menu span { cursor: pointer; padding: 2px 5px; }
        .notepad-menu span:hover { background: #316AC5; color: white; }
        .notepad-text {
            flex: 1; border: none; padding: 8px; font-family: 'Lucida Console', monospace;
            font-size: 13px; line-height: 1.4; outline: none; resize: none; background: #fff;
        }
        .notepad-status {
            padding: 3px 10px; background: #ECE9D8; border-top: 1px solid #ACA899;
            font-size: 11px; color: #555; display: flex; justify-content: space-between;
        }
    `;
    const html = `
        <div class="notepad-box">
            <div class="notepad-menu">
                <span onclick="newDoc()">File</span>
                <span onclick="cutDoc()">Edit</span>
                <span>Format</span>
                <span>View</span>
                <span onclick="alert('Windows XP Notepad AR Edition')">Help</span>
            </div>
            <textarea id="noteArea" class="notepad-text" spellcheck="false" placeholder="Type notes here..."></textarea>
            <div class="notepad-status">
                <span id="charCount">0 characters</span>
                <span>UTF-8 | Windows (CRLF)</span>
            </div>
        </div>
        <script>
            const a = document.getElementById('noteArea');
            const c = document.getElementById('charCount');
            a.addEventListener('input', () => { c.textContent = a.value.length + ' characters'; });
            function newDoc() { if (confirm('Start new document?')) { a.value = ''; c.textContent = '0 characters'; } }
            function cutDoc() { a.select(); }
        </script>
    `;
    return wrapInAppWindow('Untitled - Notepad', 'images/icons/notepad.png', html, css, screenId);
}

// ── 3. PAINT ──────────────────────────────────────────────────────────────────
export function getPaintHtml(screenId = '0') {
    const css = `
        .paint-box { display: flex; flex-direction: column; height: 100%; background: #ECE9D8; }
        .paint-toolbar {
            display: flex; align-items: center; gap: 8px; padding: 6px 10px;
            background: #ECE9D8; border-bottom: 1px solid #ACA899; flex-wrap: wrap;
        }
        .paint-btn {
            padding: 4px 10px; font-size: 12px; font-weight: bold; cursor: pointer;
            background: #fff; border: 1px solid #7F9DB9; border-radius: 3px;
        }
        .paint-btn.active { background: #C2D5F2; border-color: #316AC5; }
        .paint-canvas-wrap {
            flex: 1; position: relative; background: #7F7F7F; padding: 8px;
            overflow: hidden; display: flex; align-items: center; justify-content: center;
        }
        canvas { background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.4); cursor: crosshair; }
    `;
    const html = `
        <div class="paint-box">
            <div class="paint-toolbar">
                <button class="paint-btn active" id="btnPencil" onclick="setTool('pencil')">✏️ Pencil</button>
                <button class="paint-btn" id="btnEraser" onclick="setTool('eraser')">🧹 Eraser</button>
                <label style="font-size: 12px; margin-left: 6px;">Color: <input type="color" id="paintColor" value="#0055ff" onchange="color=this.value" style="vertical-align: middle; cursor: pointer;"></label>
                <label style="font-size: 12px; margin-left: 6px;">Size: <input type="range" id="brushSize" min="1" max="24" value="4" oninput="size=this.value" style="vertical-align: middle;"></label>
                <button class="paint-btn" onclick="clearCanvas()" style="margin-left: auto; color: #c00;">Clear</button>
            </div>
            <div class="paint-canvas-wrap">
                <canvas id="paintCanvas" width="940" height="620"></canvas>
            </div>
        </div>
        <script>
            const cvs = document.getElementById('paintCanvas');
            const ctx = cvs.getContext('2d');
            let drawing = false, tool = 'pencil', color = '#0055ff', size = 4;
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            function setTool(t) {
                tool = t;
                document.getElementById('btnPencil').classList.toggle('active', t === 'pencil');
                document.getElementById('btnEraser').classList.toggle('active', t === 'eraser');
            }
            function getPos(e) {
                const r = cvs.getBoundingClientRect();
                return { x: (e.clientX - r.left) * (cvs.width / r.width), y: (e.clientY - r.top) * (cvs.height / r.height) };
            }
            cvs.addEventListener('mousedown', (e) => {
                drawing = true;
                const p = getPos(e);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
            });
            window.addEventListener('mouseup', () => { drawing = false; });
            cvs.addEventListener('mousemove', (e) => {
                if (!drawing) return;
                const p = getPos(e);
                ctx.strokeStyle = tool === 'eraser' ? '#FFFFFF' : color;
                ctx.lineWidth = size * (tool === 'eraser' ? 3 : 1);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            });
            function clearCanvas() { ctx.clearRect(0, 0, cvs.width, cvs.height); }
        </script>
    `;
    return wrapInAppWindow('untitled - Paint', 'images/icons/paint.png', html, css, screenId);
}

// ── 4. MINESWEEPER ────────────────────────────────────────────────────────────
export function getMinesweeperHtml(screenId = '0') {
    const css = `
        .mine-wrap {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            height: 100%; background: #C0C0C0; padding: 12px; gap: 10px;
            border: 3px solid #fff; border-right-color: #808080; border-bottom-color: #808080;
        }
        .mine-header {
            display: flex; align-items: center; justify-content: space-between;
            width: 288px; padding: 4px 8px; background: #C0C0C0;
            border: 2px solid #808080; border-right-color: #fff; border-bottom-color: #fff;
        }
        .mine-lcd {
            background: #000; color: #f00; font-family: 'Consolas', monospace;
            font-size: 24px; font-weight: bold; padding: 2px 6px; letter-spacing: 2px;
        }
        .mine-face {
            width: 32px; height: 32px; font-size: 20px; cursor: pointer;
            border: 2px solid #fff; border-right-color: #808080; border-bottom-color: #808080;
            background: #C0C0C0; display: flex; align-items: center; justify-content: center;
        }
        .mine-grid {
            display: grid; grid-template-columns: repeat(9, 32px); grid-template-rows: repeat(9, 32px);
            border: 3px solid #808080; border-right-color: #fff; border-bottom-color: #fff;
        }
        .mine-cell {
            width: 32px; height: 32px; background: #C0C0C0;
            border: 2px solid #fff; border-right-color: #808080; border-bottom-color: #808080;
            display: flex; align-items: center; justify-content: center;
            font-size: 16px; font-weight: bold; cursor: pointer; user-select: none;
        }
        .mine-cell.revealed {
            border: 1px solid #7B7B7B; background: #BDBDBD;
        }
    `;
    const html = `
        <div class="mine-wrap">
            <div class="mine-header">
                <div class="mine-lcd" id="mineCnt">010</div>
                <div class="mine-face" id="faceBtn" onclick="initGame()">🙂</div>
                <div class="mine-lcd" id="timer">000</div>
            </div>
            <div class="mine-grid" id="grid"></div>
            <div style="font-size: 11px; color: #444;">Left click: Reveal | Right click: Flag 🚩</div>
        </div>
        <script>
            const rows = 9, cols = 9, totalMines = 10;
            let board = [], revealed = 0, flags = 0, timerVal = 0, timerInt = null, dead = false;
            function initGame() {
                clearInterval(timerInt); dead = false; timerVal = 0; flags = 0; revealed = 0;
                document.getElementById('timer').textContent = '000';
                document.getElementById('mineCnt').textContent = '010';
                document.getElementById('faceBtn').textContent = '🙂';
                board = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ mine: false, rev: false, flag: false, count: 0 })));
                let planted = 0;
                while (planted < totalMines) {
                    const r = Math.floor(Math.random() * rows), c = Math.floor(Math.random() * cols);
                    if (!board[r][c].mine) { board[r][c].mine = true; planted++; }
                }
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        if (board[r][c].mine) continue;
                        let m = 0;
                        for (let dr = -1; dr <= 1; dr++) {
                            for (let dc = -1; dc <= 1; dc++) {
                                const nr = r + dr, nc = c + dc;
                                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].mine) m++;
                            }
                        }
                        board[r][c].count = m;
                    }
                }
                renderGrid();
            }
            function renderGrid() {
                const g = document.getElementById('grid'); g.innerHTML = '';
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const cell = document.createElement('div');
                        cell.className = 'mine-cell';
                        cell.oncontextmenu = (e) => { e.preventDefault(); toggleFlag(r, c); };
                        cell.onclick = () => reveal(r, c);
                        g.appendChild(cell);
                    }
                }
            }
            function toggleFlag(r, c) {
                if (dead || board[r][c].rev) return;
                board[r][c].flag = !board[r][c].flag;
                flags += board[r][c].flag ? 1 : -1;
                document.getElementById('mineCnt').textContent = String(Math.max(0, totalMines - flags)).padStart(3, '0');
                updateView();
            }
            function reveal(r, c) {
                if (dead || board[r][c].rev || board[r][c].flag) return;
                if (!timerInt) timerInt = setInterval(() => { timerVal = Math.min(999, timerVal + 1); document.getElementById('timer').textContent = String(timerVal).padStart(3, '0'); }, 1000);
                board[r][c].rev = true;
                if (board[r][c].mine) {
                    dead = true; clearInterval(timerInt);
                    document.getElementById('faceBtn').textContent = '😵';
                    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (board[i][j].mine) board[i][j].rev = true;
                } else {
                    revealed++;
                    if (board[r][c].count === 0) {
                        for (let dr = -1; dr <= 1; dr++) {
                            for (let dc = -1; dc <= 1; dc++) {
                                const nr = r + dr, nc = c + dc;
                                if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) reveal(nr, nc);
                            }
                        }
                    }
                    if (revealed === rows * cols - totalMines) {
                        dead = true; clearInterval(timerInt);
                        document.getElementById('faceBtn').textContent = '😎';
                    }
                }
                updateView();
            }
            function updateView() {
                const cells = document.getElementById('grid').children;
                const colors = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000', '#808080'];
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const idx = r * cols + c, cell = cells[idx], b = board[r][c];
                        if (b.rev) {
                            cell.classList.add('revealed');
                            if (b.mine) { cell.textContent = '💣'; cell.style.background = '#ff4d4d'; }
                            else if (b.count > 0) { cell.textContent = b.count; cell.style.color = colors[b.count]; }
                            else { cell.textContent = ''; }
                        } else if (b.flag) { cell.textContent = '🚩'; }
                        else { cell.textContent = ''; cell.classList.remove('revealed'); cell.style.background = '#C0C0C0'; }
                    }
                }
            }
            initGame();
        </script>
    `;
    return wrapInAppWindow('Minesweeper', 'images/icons/minesweeper.png', html, css, screenId);
}

// ── 5. CALENDAR ───────────────────────────────────────────────────────────────
export function getCalendarHtml(screenId = '0') {
    const css = `
        .cal-box { display: flex; flex-direction: column; height: 100%; padding: 12px; background: #fff; }
        .cal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .cal-nav { background: #ECE9D8; border: 1px solid #7F9DB9; border-radius: 3px; padding: 4px 10px; cursor: pointer; font-weight: bold; }
        .cal-title { font-size: 16px; font-weight: bold; color: #0054E3; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; flex: 1; }
        .cal-cell {
            border: 1px solid #E0E0E0; border-radius: 4px; display: flex; flex-direction: column;
            padding: 4px; font-size: 13px; cursor: pointer; min-height: 50px; background: #fafafa;
        }
        .cal-cell.today { border: 2px solid #0054E3; background: #E8F0FE; font-weight: bold; }
        .cal-cell:hover { background: #eef3fc; }
        .cal-day-name { font-weight: bold; text-align: center; color: #555; padding: 4px; background: #ECE9D8; }
    `;
    const html = `
        <div class="cal-box">
            <div class="cal-head">
                <button class="cal-nav" onclick="changeM(-1)">◀ Prev</button>
                <div class="cal-title" id="mTitle">Month Year</div>
                <button class="cal-nav" onclick="changeM(1)">Next ▶</button>
            </div>
            <div class="cal-grid" id="cGrid"></div>
        </div>
        <script>
            let cur = new Date();
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            function render() {
                const g = document.getElementById('cGrid'); g.innerHTML = '';
                days.forEach(d => { const h = document.createElement('div'); h.className = 'cal-day-name'; h.textContent = d; g.appendChild(h); });
                document.getElementById('mTitle').textContent = cur.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                const y = cur.getFullYear(), m = cur.getMonth();
                const first = new Date(y, m, 1).getDay();
                const total = new Date(y, m + 1, 0).getDate();
                const today = new Date();
                for (let i = 0; i < first; i++) { const e = document.createElement('div'); g.appendChild(e); }
                for (let d = 1; d <= total; d++) {
                    const c = document.createElement('div'); c.className = 'cal-cell';
                    if (y === today.getFullYear() && m === today.getMonth() && d === today.getDate()) c.classList.add('today');
                    c.innerHTML = '<span>' + d + '</span>';
                    c.onclick = () => { const ev = prompt('Add note/event for ' + m + '/' + d + '/' + y + ':'); if (ev) { c.innerHTML += '<div style=\"font-size: 10px; background: #0054E3; color: white; border-radius: 2px; padding: 1px 3px; margin-top: 2px;\">' + ev + '</div>'; } };
                    g.appendChild(c);
                }
            }
            function changeM(d) { cur.setMonth(cur.getMonth() + d); render(); }
            render();
        </script>
    `;
    return wrapInAppWindow('Calendar', 'images/icons/calender.png', html, css, screenId);
}

// ── 6. VIDEO PLAYER (WINDOWS MEDIA PLAYER) ────────────────────────────────────
export function getVideoPlayerHtml(screenId = '0') {
    const css = `
        .wmp-box { display: flex; flex-direction: column; height: 100%; background: #000; color: #fff; }
        .wmp-bar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 12px; background: #1a1a24; border-bottom: 1px solid #333;
        }
        .wmp-select {
            background: #2a2a36; color: #00e5ff; border: 1px solid #00e5ff;
            border-radius: 4px; padding: 4px 8px; font-size: 12px; outline: none;
        }
        .wmp-view { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; }
        video { width: 100%; height: 100%; object-fit: contain; }
        .wmp-ctrls {
            display: flex; align-items: center; gap: 10px; padding: 8px 14px;
            background: linear-gradient(to bottom, #2b3040, #171922); border-top: 1px solid #444;
        }
        .wmp-btn {
            background: #3b4256; color: white; border: 1px solid #555;
            border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 13px;
        }
        .wmp-btn:hover { background: #4f5872; }
    `;
    const html = `
        <div class="wmp-box">
            <div class="wmp-bar">
                <span style="font-size: 12px; color: #aaa;">Select Video:</span>
                <select class="wmp-select" id="vidSel" onchange="loadVid(this.value)">
                    <option value="videos/samplevideo1.mp4" selected>Tek It</option>
                    <option value="videos/samplevideo2.mp4">Crystal Dolphin</option>
                    <option value="videos/samplevideo3.mp4">The Old Kanye</option>
                    <option value="videos/samplevideo4.mp4">vaaron</option>
                    <option value="textures/sintel.mp4">Sintel Movie</option>
                </select>
            </div>
            <div class="wmp-view">
                <video id="vPlayer" controls autoplay loop playsinline preload="auto">
                    <source src="videos/samplevideo1.mp4" type="video/mp4">
                </video>
            </div>
        </div>
        <script>
            const v = document.getElementById('vPlayer');
            function loadVid(src) {
                v.src = src;
                v.load();
                v.play().catch(e => console.log('Video play policy notice:', e));
            }
        </script>
    `;
    return wrapInAppWindow('Windows Media Player', 'images/icons/windows_media_player.png', html, css, screenId);
}

// ── 7. BROWSER (INTERNET EXPLORER) ────────────────────────────────────────────
export function getBrowserHtml(screenId = '0') {
    const css = `
        .ie-box { display: flex; flex-direction: column; height: 100%; background: #ECE9D8; }
        .ie-bar {
            display: flex; align-items: center; gap: 6px; padding: 6px 10px;
            background: #ECE9D8; border-bottom: 1px solid #ACA899;
        }
        .ie-btn {
            background: #ECE9D8; border: 1px solid #ACA899; border-radius: 3px;
            padding: 4px 8px; cursor: pointer; font-size: 12px;
        }
        .ie-btn:hover { background: #fff; }
        .ie-addr {
            flex: 1; padding: 4px 8px; border: 1px solid #7F9DB9; border-radius: 2px;
            font-size: 13px; outline: none; background: #fff;
        }
        .ie-content { flex: 1; border: none; width: 100%; height: 100%; }
    `;
    const html = `
        <div class="ie-box">
            <div class="ie-bar">
                <button class="ie-btn" onclick="histBack()">◀</button>
                <button class="ie-btn" onclick="histFwd()">▶</button>
                <button class="ie-btn" onclick="reloadFrame()">↻</button>
                <input class="ie-addr" id="addrBar" value="https://en.wikipedia.org" onkeydown="if(event.key==='Enter')nav()">
                <button class="ie-btn" onclick="nav()" style="background: #0058EE; color: white; font-weight: bold;">Go</button>
            </div>
            <iframe id="ieFrame" class="ie-content" src="https://en.wikipedia.org" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
        </div>
        <script>
            const f = document.getElementById('ieFrame'), b = document.getElementById('addrBar');
            function nav() {
                let u = b.value.trim();
                if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u;
                f.src = u;
            }
            function reloadFrame() { f.src = f.src; }
            function histBack() { window.history.back(); }
            function histFwd() { window.history.forward(); }
        </script>
    `;
    return wrapInAppWindow('Internet Explorer', 'images/icons/internet_explorer.png', html, css, screenId);
}

// ── 8. YOUTUBE VIEWER ─────────────────────────────────────────────────────────
export function getYouTubeHtml(screenId = '0') {
    const css = `
        .yt-box { display: flex; flex-direction: column; height: 100%; background: #0f0f0f; color: #fff; }
        .yt-bar {
            display: flex; align-items: center; gap: 8px; padding: 8px 12px;
            background: #202020; border-bottom: 1px solid #333;
        }
        .yt-input {
            flex: 1; padding: 6px 12px; background: #121212; border: 1px solid #333;
            color: #fff; border-radius: 18px; font-size: 13px; outline: none;
        }
        .yt-btn {
            background: #cc0000; color: white; border: none; border-radius: 16px;
            padding: 6px 14px; font-weight: bold; cursor: pointer;
        }
        .yt-view { flex: 1; width: 100%; height: 100%; }
        iframe { width: 100%; height: 100%; border: none; }
    `;
    const html = `
        <div class="yt-box">
            <div class="yt-bar">
                <input class="yt-input" id="ytIn" placeholder="Enter video ID or YouTube URL..." value="SCEaijZ8QmU" onkeydown="if(event.key==='Enter')loadYt()">
                <button class="yt-btn" onclick="loadYt()">Play</button>
            </div>
            <div class="yt-view">
                <iframe id="ytFrame" src="https://www.youtube-nocookie.com/embed/SCEaijZ8QmU?autoplay=1&mute=1&enablejsapi=1" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
            </div>
        </div>
        <script>
            function loadYt() {
                const inp = document.getElementById('ytIn').value.trim();
                let vid = inp;
                const m1 = inp.match(/(?:v=|\\/|embed\\/|youtu\\.be\\/)([a-zA-Z0-9_-]{11})/);
                if (m1) vid = m1[1];
                document.getElementById('ytFrame').src = 'https://www.youtube-nocookie.com/embed/' + vid + '?autoplay=1&mute=0&enablejsapi=1';
            }
        </script>
    `;
    return wrapInAppWindow('YouTube Player', 'images/icons/video_player.png', html, css, screenId);
}

// ── 9. GOOGLE MAPS ────────────────────────────────────────────────────────────
export function getGoogleMapsHtml(screenId = '0') {
    const css = `
        .maps-box { display: flex; flex-direction: column; height: 100%; }
        .maps-bar {
            display: flex; gap: 8px; padding: 8px 12px; background: #ECE9D8;
            border-bottom: 1px solid #ACA899;
        }
        .maps-input {
            flex: 1; padding: 6px 10px; border: 1px solid #7F9DB9; border-radius: 3px; font-size: 13px;
        }
        .maps-btn {
            background: #4285F4; color: white; border: none; border-radius: 3px;
            padding: 6px 14px; font-weight: bold; cursor: pointer;
        }
        iframe { flex: 1; width: 100%; height: 100%; border: none; }
    `;
    const html = `
        <div class="maps-box">
            <div class="maps-bar">
                <input class="maps-input" id="mapIn" placeholder="Search city or location (e.g. Paris, Tokyo, New York)..." value="London" onkeydown="if(event.key==='Enter')searchMap()">
                <button class="maps-btn" onclick="searchMap()">Search</button>
            </div>
            <iframe id="mapFrame" src="https://maps.google.com/maps?q=London&t=&z=13&ie=UTF8&iwloc=&output=embed"></iframe>
        </div>
        <script>
            function searchMap() {
                const q = encodeURIComponent(document.getElementById('mapIn').value.trim());
                document.getElementById('mapFrame').src = 'https://maps.google.com/maps?q=' + q + '&t=&z=13&ie=UTF8&iwloc=&output=embed';
            }
        </script>
    `;
    return wrapInAppWindow('Google Maps', 'images/icons/search.png', html, css, screenId);
}

// ── 10. MY COMPUTER ───────────────────────────────────────────────────────────
export function getMyComputerHtml(screenId = '0') {
    const css = `
        .comp-box { display: flex; flex-direction: column; height: 100%; background: #fff; }
        .comp-bar {
            display: flex; gap: 12px; padding: 6px 10px; background: #ECE9D8;
            border-bottom: 1px solid #ACA899; font-size: 12px;
        }
        .comp-main { display: flex; flex: 1; overflow: hidden; }
        .comp-side {
            width: 180px; background: linear-gradient(to bottom, #748AFF, #4057D3);
            color: white; padding: 10px; font-size: 12px;
        }
        .comp-content { flex: 1; padding: 16px; display: flex; gap: 24px; flex-wrap: wrap; align-content: flex-start; }
        .comp-item {
            display: flex; flex-direction: column; align-items: center; width: 80px;
            cursor: pointer; padding: 6px; border-radius: 4px;
        }
        .comp-item:hover { background: #e8f0fe; }
        .comp-item img { width: 44px; height: 44px; margin-bottom: 6px; }
        .comp-item span { font-size: 11px; text-align: center; }
    `;
    const html = `
        <div class="comp-box">
            <div class="comp-bar">
                <span>File</span><span>Edit</span><span>View</span><span>Favorites</span><span>Tools</span><span>Help</span>
            </div>
            <div class="comp-main">
                <div class="comp-side">
                    <h4 style="margin-bottom: 8px;">System Tasks</h4>
                    <p style="opacity: 0.9; line-height: 1.5;">View system info<br>Add or remove programs<br>Change a setting</p>
                </div>
                <div class="comp-content">
                    <div class="comp-item" onclick="alert('Local Disk (C:) - 120 GB Free')">
                        <img src="images/icons/drive_c.png" onerror="this.src='images/icons/windows.png'">
                        <span>Local Disk (C:)</span>
                    </div>
                    <div class="comp-item" onclick="alert('Network Places')">
                        <img src="images/icons/network.png">
                        <span>Network</span>
                    </div>
                    <div class="comp-item" onclick="alert('Control Panel')">
                        <img src="images/icons/control_panel.png">
                        <span>Control Panel</span>
                    </div>
                </div>
            </div>
        </div>
    `;
    return wrapInAppWindow('My Computer', 'images/icons/my_computer.png', html, css, screenId);
}

// ── 11. RECYCLE BIN ───────────────────────────────────────────────────────────
export function getRecycleBinHtml(screenId = '0') {
    const css = `
        .bin-box { display: flex; flex-direction: column; height: 100%; background: #fff; }
        .bin-bar {
            display: flex; gap: 12px; padding: 6px 10px; background: #ECE9D8;
            border-bottom: 1px solid #ACA899; font-size: 12px;
        }
        .bin-main { display: flex; flex: 1; }
        .bin-side {
            width: 180px; background: linear-gradient(to bottom, #5B82D7, #3258A8);
            color: white; padding: 12px; font-size: 12px;
        }
        .bin-side button {
            background: #ECE9D8; border: 1px solid #7F9DB9; border-radius: 3px;
            padding: 4px 8px; margin-top: 8px; cursor: pointer; font-size: 11px;
        }
        .bin-content { flex: 1; padding: 20px; color: #666; font-size: 13px; }
    `;
    const html = `
        <div class="bin-box">
            <div class="bin-bar">
                <span>File</span><span>Edit</span><span>View</span><span>Favorites</span><span>Help</span>
            </div>
            <div class="bin-main">
                <div class="bin-side">
                    <h4>Recycle Bin Tasks</h4>
                    <button onclick="emptyBin()">Empty Recycle Bin</button>
                    <button onclick="restoreBin()">Restore all items</button>
                </div>
                <div class="bin-content" id="binList">
                    <p>The Recycle Bin is currently empty.</p>
                </div>
            </div>
        </div>
        <script>
            function emptyBin() { alert('Recycle Bin Emptied.'); document.getElementById('binList').innerHTML = '<p>The Recycle Bin is empty.</p>'; }
            function restoreBin() { alert('All items restored to original locations.'); }
        </script>
    `;
    return wrapInAppWindow('Recycle Bin', 'images/icons/recyclebin.png', html, css, screenId);
}

// ── 12. FULL WINDOWS XP DESKTOP ───────────────────────────────────────────────
export function getXPDesktopHtml(screenId = '0') {
    const css = `
        .desktop-wrap {
            width: 100%; height: 100%; position: relative;
            background: #245edb url('images/icons/windows_xp.png') no-repeat center center;
            background-size: cover; overflow: hidden; font-family: Tahoma, sans-serif;
        }
        .icons-grid {
            padding: 16px; display: flex; flex-direction: column; gap: 16px;
            flex-wrap: wrap; height: calc(100% - 40px); align-content: flex-start;
        }
        .desk-icon {
            display: flex; flex-direction: column; align-items: center; width: 75px;
            cursor: pointer; padding: 4px; border-radius: 3px;
        }
        .desk-icon:hover { background: rgba(49, 106, 197, 0.4); border: 1px dotted #fff; }
        .desk-icon img { width: 36px; height: 36px; margin-bottom: 4px; }
        .desk-icon span {
            font-size: 11px; color: white; text-align: center;
            text-shadow: 1px 1px 2px #000, 0 0 4px #000;
        }
        .taskbar {
            position: absolute; bottom: 0; left: 0; right: 0; height: 36px;
            background: linear-gradient(to bottom, #2A7AD4 0%, #1353B7 50%, #19478A 100%);
            display: flex; align-items: center; padding: 0 4px; border-top: 1px solid #044FB2;
        }
        .start-btn {
            display: flex; align-items: center; gap: 6px; padding: 3px 12px;
            background: linear-gradient(to bottom, #73BC26 0%, #4C9020 92%);
            border-radius: 3px; color: white; font-weight: bold; cursor: pointer;
            box-shadow: 1px 1px 3px rgba(0,0,0,0.5); font-style: italic; font-size: 14px;
        }
        .tray-time {
            margin-left: auto; color: white; font-size: 11px; padding: 0 10px;
        }
    `;
    const html = `
        <div class="desktop-wrap">
            <div class="icons-grid">
                <div class="desk-icon" onclick="launch('calc')"><img src="images/icons/calculator.png"><span>Calculator</span></div>
                <div class="desk-icon" onclick="launch('note')"><img src="images/icons/notepad.png"><span>Notepad</span></div>
                <div class="desk-icon" onclick="launch('paint')"><img src="images/icons/paint.png"><span>Paint</span></div>
                <div class="desk-icon" onclick="launch('mine')"><img src="images/icons/minesweeper.png"><span>Minesweeper</span></div>
                <div class="desk-icon" onclick="launch('cal')"><img src="images/icons/calender.png"><span>Calendar</span></div>
                <div class="desk-icon" onclick="launch('media')"><img src="images/icons/windows_media_player.png"><span>Media</span></div>
                <div class="desk-icon" onclick="launch('ie')"><img src="images/icons/internet_explorer.png"><span>Explorer</span></div>
            </div>
            <div class="taskbar">
                <div class="start-btn" onclick="alert('Windows XP AR Edition')">
                    <img src="images/icons/windows.png" width="18" height="18"> start
                </div>
                <div class="tray-time" id="clock">12:00 PM</div>
            </div>
        </div>
        <script>
            function updateClock() {
                const now = new Date();
                document.getElementById('clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            setInterval(updateClock, 1000); updateClock();
            function launch(app) {
                window.parent.postMessage({ action: 'launchApp', appType: app }, '*');
            }
        </script>
    `;
    return wrapInAppWindow('Windows XP Desktop', 'images/icons/windows.png', html, css, screenId);
}

