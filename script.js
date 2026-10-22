(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const boardEl = $('board');
  const statusEl = $('status');
  const movesEl = $('moves');
  const modeEl = $('mode');
  const sideEl = $('side');
  const levelEl = $('level');

  const glyph = {
    w: { q: '♕', k: '♔', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { q: '♛', k: '♚', r: '♜', b: '♝', n: '♞', p: '♟' }
  };

  const files = ['a','b','c','d','e','f','g','h'];

  let game = null;
  let selected = null;
  let legalTargets = [];
  let flipped = false;
  let thinking = false;
  let engine = null;
  let engineReady = false;
  let engineFailed = false;
  let engineStarting = false;
  let botWaitTimer = null;
  let moveLog = [];
  let lastMove = null;

  function isBotTurn() {
    return modeEl.value === 'bot' &&
      game && game.turn() !== sideEl.value;
  }

  function setStatus(text) {
    statusEl.textContent = text;
    if (game && $('turn-dot')) {
      $('turn-dot').style.background =
        game.turn() === 'w' ? '#f2f3e9' : '#8eabc5';
    }
  }

  function gameStatus() {
    if (game.in_checkmate())
      return `Мат! ${game.turn() === 'w' ? 'Қаралар' : 'Ақтар'} жеңді.`;
    if (game.in_stalemate()) return 'Пат — ойын тең аяқталды.';
    if (game.in_draw()) return 'Тең ойын.';
    if (game.in_check())
      return `${game.turn() === 'w' ? 'Ақтардың' : 'Қаралардың'} патшасына шах!`;
    return `${game.turn() === 'w' ? 'Ақтардың' : 'Қаралардың'} жүрісі`;
  }

  function render() {
    if (!game) return;

    boardEl.innerHTML = '';

    const rows = flipped
      ? [0,1,2,3,4,5,6,7]
      : [7,6,5,4,3,2,1,0];

    const cols = flipped
      ? [7,6,5,4,3,2,1,0]
      : [0,1,2,3,4,5,6,7];

    rows.forEach((rankIndex, row) => {
      cols.forEach((fileIndex, col) => {
        const sq = files[fileIndex] + (rankIndex + 1);
        const piece = game.get(sq);
        const btn = document.createElement('button');

        btn.type = 'button';
        btn.className = 'square ' +
          (((rankIndex + fileIndex) % 2 === 0) ? 'dark' : 'light');

        btn.setAttribute('role', 'gridcell');
        btn.setAttribute('aria-label',
          `${sq}${piece ? ', ' +
          (piece.color === 'w' ? 'ақ' : 'қара') + ' фигура' : ''}`);

        btn.dataset.square = sq;

        if (selected === sq) btn.classList.add('selected');

        if (lastMove &&
            (lastMove.from === sq || lastMove.to === sq)) {
          btn.classList.add('last-move');
        }

        const target = legalTargets.find(m => m.to === sq);

        if (target) {
          btn.classList.add('legal');
          if (target.captured) btn.classList.add('capture');
        }

        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece ' +
            (piece.color === 'w' ? 'white-piece' : 'black-piece');
          span.textContent = glyph[piece.color][piece.type];
          btn.appendChild(span);
        }

        if (col === 0) {
          const coord = document.createElement('span');
          coord.className = 'coord';
          coord.textContent = rankIndex + 1;
          btn.appendChild(coord);
        }

        if (row === 7) {
          const coord = document.createElement('span');
          coord.className = 'coord';
          coord.style.left = 'auto';
          coord.style.right = '4px';
          coord.style.top = 'auto';
          coord.style.bottom = '3px';
          coord.textContent = files[fileIndex];
          btn.appendChild(coord);
        }

        btn.addEventListener('click', () => onSquareClick(sq));
        boardEl.appendChild(btn);
      });
    });

    setStatus(gameStatus());
    renderMoves();
    $('undo').disabled = moveLog.length === 0 || thinking;
  }

  function renderMoves() {
    movesEl.innerHTML = '';

    if (!moveLog.length) {
      const li = document.createElement('li');
      li.className = 'empty-moves';
      li.textContent = 'Әзірге жүріс жоқ';
      movesEl.appendChild(li);
      return;
    }

    for (let i = 0; i < moveLog.length; i += 2) {
      const li = document.createElement('li');
      li.textContent =
        `${Math.floor(i / 2) + 1}. ${moveLog[i]}` +
        `${moveLog[i + 1] ? '   ' + moveLog[i + 1] : ''}`;
      movesEl.appendChild(li);
    }
  }

  function onSquareClick(sq) {
    if (!game || thinking || game.game_over() || isBotTurn()) return;

    const piece = game.get(sq);

    if (selected) {
      const move = game.move({
        from: selected,
        to: sq,
        promotion: 'q'
      });

      if (move) {
        lastMove = { from: move.from, to: move.to };
        moveLog.push(move.san);
        selected = null;
        legalTargets = [];
        render();

        if (isBotTurn() && !game.game_over()) botMove();
        return;
      }
    }

    if (piece && piece.color === game.turn()) {
      selected = sq;
      legalTargets = game.moves({
        square: sq,
        verbose: true
      });
    } else {
      selected = null;
      legalTargets = [];
    }

    render();
  }

  function clearBotWaitTimer() {
    if (botWaitTimer !== null) clearTimeout(botWaitTimer);
    botWaitTimer = null;
  }

  function engineNote(text) {
    if ($('engine-note')) $('engine-note').textContent = text;
  }

  function initEngine() {
    if (engine || engineFailed || engineStarting) return;

    try {
      engineStarting = true;
      engine = new Worker('engine/stockfish-19-lite-single.js');

      engine.onmessage = event => {
        const line = typeof event.data === 'string'
          ? event.data : '';

        if (line === 'uciok') {
          engine.postMessage('isready');
          return;
        }

        if (line === 'readyok') {
          engineReady = true;
          engineStarting = false;

          engineNote(
            'Stockfish 19 қосылды — компьютер толық шахмат қозғалтқышымен ойнайды.'
          );

          if (thinking && isBotTurn() && !game.game_over()) {
            clearBotWaitTimer();
            askStockfishMove();
          }
          return;
        }

        if (line.startsWith('bestmove ')) {
          if (!thinking || !isBotTurn() || game.game_over()) return;

          const uci = line.trim().split(/\s+/)[1];

          thinking = false;
          clearBotWaitTimer();

          if (uci && uci !== '(none)' && uci.length >= 4) {
            const move = game.move({
              from: uci.slice(0, 2),
              to: uci.slice(2, 4),
              promotion: uci[4] || 'q'
            });

            if (move) {
              lastMove = { from: move.from, to: move.to };
              moveLog.push(move.san);
            }
          }

          render();
        }
      };

      engine.onerror = () => {
        engineFailed = true;
        engineReady = false;
        engineStarting = false;

        try { engine.terminate(); } catch (e) {}
        engine = null;

        engineNote('Stockfish ашылмады. Қосалқы бот қолданылады.');

        if (thinking && isBotTurn() && !game.game_over()) {
          clearBotWaitTimer();
          playFallbackBot();
        }
      };

      engine.postMessage('uci');
    } catch (e) {
      engineFailed = true;
      engineStarting = false;
      engine = null;
      engineNote('Stockfish қосылмады. Қосалқы бот қолданылады.');
    }
  }

  function askStockfishMove() {
    if (!engine || !engineReady || !thinking ||
        !isBotTurn() || game.game_over()) return;

    const level = Number(levelEl.value);
    const skill = level === 5 ? 2 : level === 10 ? 8 : 15;

    engine.postMessage('setoption name Skill Level value ' + skill);
    engine.postMessage('position fen ' + game.fen());
    engine.postMessage('go depth ' + level);
  }

  function evaluatePosition(perspective) {
    if (game.in_checkmate()) {
      return game.turn() === perspective ? -100000 : 100000;
    }

    if (game.in_draw() || game.in_stalemate()) return 0;

    const values = {
      p: 100, n: 320, b: 330, r: 500, q: 900, k: 0
    };

    const board = game.board();
    let score = 0;

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const p = board[row][col];
        if (!p) continue;

        const sign = p.color === perspective ? 1 : -1;
        score += sign * values[p.type];

        const centerDistance =
          Math.abs(3.5 - row) + Math.abs(3.5 - col);

        if (p.type === 'n' || p.type === 'b') {
          score += sign * Math.round((4 - centerDistance / 2) * 5);
        }

        if (p.type === 'p') {
          const advance = p.color === 'w' ? 6 - row : row - 1;
          score += sign * Math.max(0, advance) * 3;
        }
      }
    }

    if (game.in_check()) {
      score += game.turn() === perspective ? -25 : 25;
    }

    return score;
  }

  function makeMove(m) {
    const result = game.move({
      from: m.from,
      to: m.to,
      promotion: m.promotion || 'q'
    });

    if (result) {
      lastMove = { from: result.from, to: result.to };
      moveLog.push(result.san);
    }
  }

  function playFallbackBot() {
    if (!game || !thinking || !isBotTurn() || game.game_over()) {
      thinking = false;
      render();
      return;
    }

    const moves = game.moves({ verbose: true });

    if (!moves.length) {
      thinking = false;
      render();
      return;
    }

    const level = Number(levelEl.value);
    const botColor = game.turn();

    // Жеңіл: кездейсоқ заңды жүріс.
    if (level === 5) {
      makeMove(moves[Math.floor(Math.random() * moves.length)]);
      thinking = false;
      render();
      return;
    }

    const scored = [];

    for (const candidate of moves) {
      game.move({
        from: candidate.from,
        to: candidate.to,
        promotion: candidate.promotion || 'q'
      });

      let score;

      // Орташа: материал мен орналасуды бағалау.
      if (level === 10) {
        score = evaluatePosition(botColor) + Math.random() * 18;
      } else if (game.game_over()) {
        score = evaluatePosition(botColor);
      } else {
        // Күшті: қарсыластың ықтимал жауабын да қарайды.
        const replies = game.moves({ verbose: true });
        let worst = Infinity;

        for (const reply of replies) {
          game.move({
            from: reply.from,
            to: reply.to,
            promotion: reply.promotion || 'q'
          });

          const replyScore = evaluatePosition(botColor);
          game.undo();

          if (replyScore < worst) worst = replyScore;
        }

        score = replies.length
          ? worst : evaluatePosition(botColor);
        score += Math.random() * 3;
      }

      game.undo();
      scored.push({ move: candidate, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const pool = level === 10
      ? scored.slice(0, Math.min(4, scored.length))
      : scored.slice(0, Math.min(2, scored.length));

    makeMove(pool[Math.floor(Math.random() * pool.length)].move);
    thinking = false;
    render();
  }

  function botMove() {
    if (!game || !isBotTurn() ||
        game.game_over() || thinking) return;

    thinking = true;
    render();
    setStatus('Компьютер жүріс ойластырып жатыр…');
    initEngine();

    if (engineReady && engine) {
      askStockfishMove();
      return;
    }

    clearBotWaitTimer();

    botWaitTimer = setTimeout(() => {
      botWaitTimer = null;

      if (!thinking || !isBotTurn() || game.game_over()) {
        thinking = false;
        render();
        return;
      }

      if (engineReady && engine) {
        askStockfishMove();
      } else {
        playFallbackBot();
      }
    }, engineFailed ? 100 : 5000);
  }

  function reset() {
    clearBotWaitTimer();

    if (engine) {
      try { engine.terminate(); } catch (e) {}
    }

    engine = null;
    engineReady = false;
    engineFailed = false;
    engineStarting = false;

    game = new Chess();
    selected = null;
    legalTargets = [];
    thinking = false;
    moveLog = [];
    lastMove = null;

    render();

    if (modeEl.value === 'bot' && sideEl.value === 'b') {
      setTimeout(botMove, 350);
    }
  }

  $('new-game').addEventListener('click', reset);

  $('undo').addEventListener('click', () => {
    if (!game || thinking) return;

    const count = modeEl.value === 'bot'
      ? Math.min(2, game.history().length) : 1;

    for (let i = 0; i < count; i++) {
      if (game.undo()) moveLog.pop();
    }

    lastMove = null;

    const hist = game.history({ verbose: true });

    if (hist.length) {
      lastMove = {
        from: hist[hist.length - 1].from,
        to: hist[hist.length - 1].to
      };
    }

    selected = null;
    legalTargets = [];
    render();
  });

  $('flip').addEventListener('click', () => {
    flipped = !flipped;
    render();
  });

  modeEl.addEventListener('change', () => {
    sideEl.disabled = modeEl.value === 'local';
    levelEl.disabled = modeEl.value === 'local';
    reset();
  });

  sideEl.addEventListener('change', reset);
  levelEl.addEventListener('change', () => {});

  if (typeof Chess === 'undefined') {
    statusEl.textContent =
      'Шахмат ережелері жүктелмеді. Интернетті қосып, бетті қайта аш.';

    engineNote('chess.js кітапханасы жүктелмеді.');
    $('new-game').disabled = true;
    $('undo').disabled = true;
    $('flip').disabled = true;
  } else {
    game = new Chess();
    sideEl.disabled = false;
    render();
  }
})();