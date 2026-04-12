// ═══════════════════════════════════════════════════════════════
// EQUESTRIA FOOTBALL — euro.js
// Bloc 8 : Euro Equestria — Tournoi des nations
// ═══════════════════════════════════════════════════════════════
//
// EuroEngine gère :
//   - Sélection nationale (top 26 joueurs par nation)
//   - Phase de groupes (6 groupes × 4 nations, round-robin)
//   - Qualification : top 2/groupe (12) + meilleurs 4 troisièmes = 16
//   - Phases knockout : R16 → QF → SF → Finale (match sec)
//   - Simulation tick par tick (phase par phase)
//   - Fréquence : tous les N saisons (canon.euro.frequency_seasons)
//
// Architecture : "euro canon" — copie légère du canon avec
//   les nations comme "clubs" et leurs meilleurs joueurs assignés
//
// ───────────────────────────────────────────────────────────────

'use strict';

const EuroEngine = (() => {

  const STORAGE_KEY = 'eq_euro_v1';

  // ─── NATIONS EQUESTRIA ────────────────────────────────────
  // 15 nations avec des joueurs dans le canon + 9 fictives pour compléter à 24
  const NATION_META = {
    ishgar:        { name: 'Ishgar',         flag: '⚔️',  color: '#e11d48', abbr: 'ISH' },
    brislovia:     { name: 'Brislovia',      flag: '🏔️',  color: '#3b82f6', abbr: 'BRI' },
    savanna:       { name: 'Savanna',        flag: '🦁',  color: '#f59e0b', abbr: 'SAV' },
    bermudes:      { name: 'Bermudes',       flag: '🌊',  color: '#06b6d4', abbr: 'BER' },
    javanie:       { name: 'Javanie',        flag: '🌴',  color: '#10b981', abbr: 'JAV' },
    desertiqua:    { name: 'Desertiqua',     flag: '🏜️',  color: '#d97706', abbr: 'DES' },
    paysTropMignon:{ name: 'Pays Trop Mignon', flag: '🌸', color: '#ec4899', abbr: 'PTM' },
    wales:         { name: 'Walisia',        flag: '🐉',  color: '#dc2626', abbr: 'WAL' },
    porespagne:    { name: 'Porespagne',     flag: '🌹',  color: '#c026d3', abbr: 'POR' },
    crannbanie:    { name: 'Crannbanie',     flag: '🌙',  color: '#6366f1', abbr: 'CRA' },
    wesfalie:      { name: 'Wesfalie',       flag: '⚡',  color: '#64748b', abbr: 'WES' },
    vulgarie:      { name: 'Vulgarie',       flag: '🗡️',  color: '#7c3aed', abbr: 'VUL' },
    paxifista:     { name: 'Paxifista',      flag: '☮️',  color: '#0ea5e9', abbr: 'PAX' },
    canterlot:     { name: 'Canterlot',      flag: '✨',  color: '#a855f7', abbr: 'CAN' },
    wakanda:       { name: 'Wakanda',        flag: '🌿',  color: '#16a34a', abbr: 'WAK' },
    // 9 nations fictives pour compléter le tableau à 24
    romania:      { name: 'Romania',       flag: '❄️',  color: '#bfdbfe', abbr: 'NOR' },
    bulga:       { name: 'Bulga',        flag: '☀️',  color: '#fde68a', abbr: 'SOL' },
    botlie:     { name: 'Botlie',      flag: '💧',  color: '#67e8f9', abbr: 'AQU' },
    vietnam:        { name: 'Vietnam',         flag: '⚙️',  color: '#9ca3af', abbr: 'FER' },
    yakistan:       { name: 'Yakistan',        flag: '🔮',  color: '#c4b5fd', abbr: 'LUM' },
    balouthikistan:       { name: 'Baloutchikistan',        flag: '🌲',  color: '#4ade80', abbr: 'SYL' },
    nordheim:       { name: 'Nordheim',        flag: '🔥',  color: '#f97316', abbr: 'PYR' },
    Masalie:      { name: 'Masalie',       flag: '🌟',  color: '#fcd34d', abbr: 'CEL' },
    abyssinie:       { name: 'Abyssinie',        flag: '🌑',  color: '#374151', abbr: 'ABY' },
  };

  const PHASE_SEQUENCE = ['idle','groups','r16','qf','sf','final','complete'];

  // ─── UTILS ────────────────────────────────────────────────
  function seededRNG(seed) {
    let s = seed >>> 0;
    return function() {
      s |= 0; s = s + 0x6D2B79F5 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ─── SÉLECTION NATIONALE ─────────────────────────────────
  // Retourne les 26 meilleurs joueurs d'une nation
  function buildNationalSquad(nationId, canon, squadSize = 26) {
    const players = Object.values(canon.players)
      .filter(p => p.nationality === nationId)
      .sort((a, b) => (b.ovr || 0) - (a.ovr || 0))
      .slice(0, squadSize);
    return players;
  }

  // Calcule l'OVR moyen d'une sélection nationale
  function nationStrength(nationId, canon) {
    const squad = buildNationalSquad(nationId, canon, 11);
    if (!squad.length) return 65; // nation fictive
    return Math.round(squad.reduce((s, p) => s + (p.ovr || 70), 0) / squad.length);
  }

  // ─── EURO CANON ──────────────────────────────────────────
  // Crée un canon modifié où les nations jouent comme des clubs
  // Chaque joueur est temporairement réassigné à son "club national"
  function buildEuroCanon(participantIds, baseCanon) {
    // Copie légère — on ne clone que ce qui est nécessaire
    const euroCanon = {
      leagues: {},
      clubs:   {},
      players: {},
    };

    for (const natId of participantIds) {
      const meta = NATION_META[natId] || { name: natId, flag: '🏳️', color: '#888' };

      // Club national fictif
      euroCanon.clubs[natId] = {
        id:       natId,
        name:     meta.name,
        tier:     'top',
        league:   'EURO',
        nation:   natId,
        stadium:  'Euro Arena',
        capacity: 90000,
      };

      // Assignation des joueurs à leur nation
      const squad = buildNationalSquad(natId, baseCanon);
      const fakeSquad = squad.map(p => ({ ...p, club: natId }));

      // Nations fictives (pas de joueurs dans le canon) → génère un squad synthétique
      if (!fakeSquad.length) {
        const strength = 72 + Math.floor(Math.random() * 6); // 72–77
        for (let i = 0; i < 18; i++) {
          const pos = ['GK','CB','CB','LB','RB','CDM','CM','CM','CAM','LW','RW','ST',
                       'CB','CDM','CM','CAM','ST','LW'][i];
          fakeSquad.push({
            id:          `${natId}_auto_${i}`,
            name:        `${meta.abbr||natId} Player ${i+1}`,
            club:        natId,
            nationality: natId,
            position:    pos,
            ovr:         strength - Math.floor(i / 3),
            age:         22 + Math.floor(Math.random() * 10),
          });
        }
      }

      for (const p of fakeSquad) {
        euroCanon.players[p.id || p.name] = p;
      }
    }

    return euroCanon;
  }

  // ─── INIT EURO ───────────────────────────────────────────
  function initEuro(canon, season) {
    const cfg  = canon.euro || {};
    const rng  = seededRNG((season.seed || season.year * 10000) + 55555);
    const year = season.year;

    // Participants : les 15 nations réelles + nations fictives jusqu'à 24
    const realNations = Object.keys(NATION_META).filter(n =>
      Object.values(canon.players).some(p => p.nationality === n)
    );
    const fakeNations = Object.keys(NATION_META).filter(n => !realNations.includes(n));
    const needed      = (cfg.teams || 24) - realNations.length;
    const participants = [...realNations, ...fakeNations.slice(0, needed)];

    // Tirage des 6 groupes de 4 (pot par force)
    const sorted = [...participants].sort((a, b) =>
      nationStrength(b, canon) - nationStrength(a, canon)
    );
    const numGroups = cfg.groups || 6;
    const perGroup  = cfg.teams_per_group || 4;
    const groups    = _drawGroups(sorted, numGroups, perGroup, rng);

    // Build the euro canon for simulation
    const euroCanon = buildEuroCanon(participants, canon);

    return {
      phase:        'idle',
      year,
      baseSeed:     (season.seed || year * 10000) + 55555,
      config:       cfg,
      participants,
      euroCanon,
      groups,         // { A: ['NAT1','NAT2','NAT3','NAT4'], B: [...], ... }
      groupResults:   {},  // { A: { results:[], standings:{} }, ... }
      qualified:      [],  // 16 qualifiés pour le KO
      knockout:       { r16: null, qf: null, sf: null, final: null },
      knockoutBracket:[],
      winner:         null,
    };
  }

  // ─── TIRAGE DES GROUPES ──────────────────────────────────
  // Pot 1 = meilleures nations, Pot 2 = suivantes, etc.
  // Une nation par pot dans chaque groupe
  function _drawGroups(sorted, numGroups, perGroup, rng) {
    const pots = [];
    for (let p = 0; p < perGroup; p++) {
      pots.push(shuffle(sorted.slice(p * numGroups, (p + 1) * numGroups), rng));
    }
    const groups = {};
    const letters = 'ABCDEF'.slice(0, numGroups).split('');
    for (let g = 0; g < numGroups; g++) {
      groups[letters[g]] = pots.map(pot => pot[g]).filter(Boolean);
    }
    return groups;
  }

  // ─── TICK EURO ───────────────────────────────────────────
  function tickEuro(euro, canon) {
    if (euro.phase === 'complete') return euro;
    const idx  = PHASE_SEQUENCE.indexOf(euro.phase);
    const next = PHASE_SEQUENCE[idx + 1];
    const upd  = JSON.parse(JSON.stringify(euro));

    switch (next) {
      case 'groups': return _runGroups(upd, canon);
      case 'r16':    return _runR16(upd, canon);
      case 'qf':     return _runQF(upd, canon);
      case 'sf':     return _runSF(upd, canon);
      case 'final':  return _runFinal(upd, canon);
      default:       return upd;
    }
  }

  // ─── PHASE DE GROUPES ─────────────────────────────────────
  function _runGroups(euro, canon) {
    const rng = seededRNG(euro.baseSeed + 1111);
    const ec  = euro.euroCanon;

    for (const [letter, nations] of Object.entries(euro.groups)) {
      const results   = [];
      const standings = {};

      for (const n of nations) {
        standings[n] = { id:n, played:0, won:0, drawn:0, lost:0, gf:0, ga:0, gd:0, pts:0 };
      }

      // Round-robin : chaque nation rencontre les 3 autres
      for (let i = 0; i < nations.length; i++) {
        for (let j = i + 1; j < nations.length; j++) {
          const home = nations[i];
          const away = nations[j];
          const m    = MatchEngine.simulateMatch(home, away, {
            canon: ec,
            seed:  rng() * 1000000 | 0,
          });
          results.push({ home, away, score: m.score, result: m.result, motm: m.motm });

          const h = standings[home];
          const a = standings[away];
          h.played++; h.gf += m.score.home; h.ga += m.score.away; h.gd = h.gf - h.ga;
          a.played++; a.gf += m.score.away; a.ga += m.score.home; a.gd = a.gf - a.ga;
          if (m.result === 'home')      { h.won++; h.pts += 3; a.lost++; }
          else if (m.result === 'away') { a.won++; a.pts += 3; h.lost++; }
          else                          { h.drawn++; h.pts++; a.drawn++; a.pts++; }
        }
      }

      euro.groupResults[letter] = {
        results,
        standings: Object.values(standings).sort(
          (a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
        ),
      };
    }

    // Qualification : top 2 par groupe + meilleurs 3e
    const qualTop2  = [];
    const thirds    = [];
    for (const grp of Object.values(euro.groupResults)) {
      qualTop2.push(grp.standings[0].id, grp.standings[1].id);
      thirds.push(grp.standings[2]);
    }
    const bestThirds = thirds
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf)
      .slice(0, euro.config.best_thirds || 4)
      .map(r => r.id);

    euro.qualified      = shuffle([...qualTop2, ...bestThirds], rng);
    euro.knockoutBracket = euro.qualified;
    euro.phase          = 'groups';
    return euro;
  }

  // ─── KNOCKOUT ROUNDS ──────────────────────────────────────
  function _koRound(euro, canon, phaseName, twoLegs = false, neutral = false) {
    const rng     = seededRNG(euro.baseSeed + { r16:2222, qf:3333, sf:4444, final:5555 }[phaseName]);
    const bracket = shuffle([...euro.knockoutBracket], rng);
    const ec      = euro.euroCanon;
    const results = [];
    const winners = [];

    for (let i = 0; i < bracket.length; i += 2) {
      if (i + 1 >= bracket.length) continue;
      const home = bracket[i];
      const away = bracket[i + 1];

      if (twoLegs) {
        const leg1 = MatchEngine.simulateMatch(home, away, { canon: ec, seed: rng()*1000000|0 });
        const leg2 = MatchEngine.simulateMatch(away, home, { canon: ec, seed: rng()*1000000|0 });
        const ah   = leg1.score.home + leg2.score.away;
        const aa   = leg1.score.away + leg2.score.home;
        const win  = ah > aa ? home : aa > ah ? away : (rng() < 0.5 ? home : away);
        results.push({ home, away, leg1: leg1.score, leg2: { home: leg2.score.away, away: leg2.score.home }, agg: { home: ah, away: aa }, winner: win });
        winners.push(win);
      } else {
        const m   = MatchEngine.simulateMatch(home, away, { canon: ec, seed: rng()*1000000|0, neutral });
        const win = m.result === 'home' ? home : m.result === 'away' ? away : (rng() < 0.5 ? home : away);
        results.push({ home, away, score: m.score, winner: win, motm: m.motm });
        winners.push(win);
      }
    }

    euro.knockout[phaseName] = { results, winners };
    euro.knockoutBracket     = winners;
    euro.phase               = phaseName;
    return euro;
  }

  function _runR16(euro, canon)   { return _koRound(euro, canon, 'r16',   false, false); }
  function _runQF(euro, canon)    { return _koRound(euro, canon, 'qf',    false, false); }
  function _runSF(euro, canon)    { return _koRound(euro, canon, 'sf',    false, false); }
  function _runFinal(euro, canon) {
    euro = _koRound(euro, canon, 'final', false, true);
    euro.winner = euro.knockoutBracket[0] || euro.knockout.final?.winners?.[0] || null;
    euro.phase  = 'complete';
    return euro;
  }

  // ─── RUN FULL EURO ────────────────────────────────────────
  function runFullEuro(canon, season) {
    let e = initEuro(canon, season);
    const phases = ['groups','r16','qf','sf','final'];
    for (const _ of phases) e = tickEuro(e, canon);
    return e;
  }

  // ─── PHASE LABELS ─────────────────────────────────────────
  function getPhaseLabel(phase) {
    const labels = {
      idle:     'Prêt',
      groups:   'Phase de groupes',
      r16:      'Huitièmes de finale',
      qf:       'Quarts de finale',
      sf:       'Demi-finales',
      final:    'Finale',
      complete: 'Terminé',
    };
    return labels[phase] || phase;
  }

  function getNextPhaseLabel(phase) {
    const idx = PHASE_SEQUENCE.indexOf(phase);
    if (idx < 0 || idx >= PHASE_SEQUENCE.length - 2) return null;
    return getPhaseLabel(PHASE_SEQUENCE[idx + 1]);
  }

  function getNationName(id) {
    return NATION_META[id]?.name || id;
  }
  function getNationFlag(id) {
    return NATION_META[id]?.flag || '🏳️';
  }
  function getNationColor(id) {
    return NATION_META[id]?.color || '#888';
  }

  // ─── STORAGE ──────────────────────────────────────────────
  function saveEuro(euro) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(euro)); } catch(e) {}
  }
  function loadEuro() {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch(e) { return null; }
  }
  function clearEuro() { localStorage.removeItem(STORAGE_KEY); }

  // ─── PUBLIC ───────────────────────────────────────────────
  return {
    initEuro,
    tickEuro,
    runFullEuro,
    getPhaseLabel,
    getNextPhaseLabel,
    getNationName,
    getNationFlag,
    getNationColor,
    buildNationalSquad,
    nationStrength,
    NATION_META,
    PHASE_SEQUENCE,
  };

})();

if (typeof module !== 'undefined') module.exports = EuroEngine;
