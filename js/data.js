'use strict';
/* =====================================================================
   Game data: equipment list (costs/bundles/arms levels per the 1.5
   manual), computer players, talk files, colors, and the options menus.
   ===================================================================== */

const Data = (() => {
  const W = 'W', M = 'M';

  // r = blast radius in pixels, dmg = damage at ground zero (tank energy is 100)
  const items = [
    { id: 'babyMissile', name: 'Baby Missile', cost: 400, bundle: 10, arms: 0, cat: W, kind: 'missile', r: 10, dmg: 55 },
    { id: 'missile', name: 'Missile', cost: 1875, bundle: 5, arms: 0, cat: W, kind: 'missile', r: 20, dmg: 100 },
    { id: 'babyNuke', name: 'Baby Nuke', cost: 10000, bundle: 3, arms: 0, cat: W, kind: 'nuke', r: 40, dmg: 190 },
    { id: 'nuke', name: 'Nuke', cost: 12000, bundle: 1, arms: 1, cat: W, kind: 'nuke', r: 75, dmg: 330 },
    { id: 'leapFrog', name: 'LeapFrog', cost: 10000, bundle: 2, arms: 3, cat: W, kind: 'leapfrog', radii: [30, 25, 20], dmgs: [125, 110, 95] },
    { id: 'funkyBomb', name: 'Funky Bomb', cost: 7000, bundle: 2, arms: 4, cat: W, kind: 'funky', r: 80, dmg: 80 },
    { id: 'mirv', name: 'MIRV', cost: 10000, bundle: 3, arms: 2, cat: W, kind: 'mirv', n: 5, subR: 20, dmg: 100 },
    { id: 'deathsHead', name: "Death's Head", cost: 20000, bundle: 1, arms: 4, cat: W, kind: 'mirv', n: 9, subR: 35, dmg: 160 },
    { id: 'napalm', name: 'Napalm', cost: 10000, bundle: 10, arms: 2, cat: W, kind: 'napalm', amount: 95, heat: 2.5 },
    { id: 'hotNapalm', name: 'Hot Napalm', cost: 20000, bundle: 2, arms: 4, cat: W, kind: 'napalm', amount: 125, heat: 6.4 },
    { id: 'tracer', name: 'Tracer', cost: 10, bundle: 20, arms: 0, cat: W, kind: 'tracer' },
    { id: 'smokeTracer', name: 'Smoke Tracer', cost: 500, bundle: 10, arms: 1, cat: W, kind: 'tracer', smoke: true },
    { id: 'babyRoller', name: 'Baby Roller', cost: 5000, bundle: 10, arms: 2, cat: W, kind: 'roller', r: 10, dmg: 55 },
    { id: 'roller', name: 'Roller', cost: 6000, bundle: 5, arms: 2, cat: W, kind: 'roller', r: 20, dmg: 100 },
    { id: 'heavyRoller', name: 'Heavy Roller', cost: 6750, bundle: 2, arms: 3, cat: W, kind: 'roller', r: 45, dmg: 210 },
    { id: 'riotCharge', name: 'Riot Charge', cost: 2000, bundle: 10, arms: 2, cat: W, kind: 'riot', r: 36, spread: 44 },
    { id: 'riotBlast', name: 'Riot Blast', cost: 5000, bundle: 5, arms: 3, cat: W, kind: 'riot', r: 60, spread: 58 },
    { id: 'riotBomb', name: 'Riot Bomb', cost: 5000, bundle: 5, arms: 3, cat: W, kind: 'riotbomb', r: 30 },
    { id: 'heavyRiotBomb', name: 'Heavy Riot Bomb', cost: 4750, bundle: 2, arms: 3, cat: W, kind: 'riotbomb', r: 45 },
    { id: 'babyDigger', name: 'Baby Digger', cost: 3000, bundle: 10, arms: 0, cat: W, kind: 'digger', n: 3, len: 34, width: 2 },
    { id: 'digger', name: 'Digger', cost: 2500, bundle: 5, arms: 0, cat: W, kind: 'digger', n: 5, len: 55, width: 3 },
    { id: 'heavyDigger', name: 'Heavy Digger', cost: 6750, bundle: 2, arms: 1, cat: W, kind: 'digger', n: 8, len: 85, width: 4 },
    { id: 'babySandhog', name: 'Baby Sandhog', cost: 10000, bundle: 10, arms: 0, cat: W, kind: 'sandhog', n: 3, len: 36, width: 2, r: 8, dmg: 45 },
    { id: 'sandhog', name: 'Sandhog', cost: 16750, bundle: 5, arms: 0, cat: W, kind: 'sandhog', n: 5, len: 50, width: 3, r: 10, dmg: 55 },
    { id: 'heavySandhog', name: 'Heavy Sandhog', cost: 25000, bundle: 2, arms: 1, cat: W, kind: 'sandhog', n: 9, len: 70, width: 4, r: 12, dmg: 65 },
    { id: 'dirtClod', name: 'Dirt Clod', cost: 5000, bundle: 10, arms: 0, cat: W, kind: 'dirt', r: 7 },
    { id: 'dirtBall', name: 'Dirt Ball', cost: 5000, bundle: 5, arms: 0, cat: W, kind: 'dirt', r: 12 },
    { id: 'tonOfDirt', name: 'Ton of Dirt', cost: 6750, bundle: 2, arms: 1, cat: W, kind: 'dirt', r: 20 },
    { id: 'liquidDirt', name: 'Liquid Dirt', cost: 5000, bundle: 5, arms: 2, cat: W, kind: 'liquiddirt', amount: 280 },
    { id: 'dirtCharge', name: 'Dirt Charge', cost: 5000, bundle: 10, arms: 1, cat: W, kind: 'dirtcharge', r: 55, spread: 41 },
    { id: 'earthDisrupter', name: 'Earth Disrupter', cost: 5000, bundle: 10, arms: 0, cat: W, kind: 'disrupter' },
    { id: 'plasmaBlast', name: 'Plasma Blast', cost: 9000, bundle: 5, arms: 3, cat: W, kind: 'plasma' },
    { id: 'laser', name: 'Laser', cost: 5000, bundle: 5, arms: 2, cat: W, kind: 'laser' },
    // Remastered's extended arsenal (Weapons > Extended Arsenal)
    { id: 'airStrike', name: 'Air Strike', cost: 14000, bundle: 2, arms: 2, cat: W, kind: 'airstrike', n: 5, ext: true, onShield: true },
    { id: 'teleporter', name: 'Teleporter', cost: 9000, bundle: 3, arms: 1, cat: W, kind: 'teleport', ext: true, onShield: true },
    { id: 'teslaCoil', name: 'Tesla Coil', cost: 15000, bundle: 3, arms: 3, cat: W, kind: 'tesla', r: 70, dmgs: [75, 55, 35], ext: true, onShield: true },
    { id: 'bunkerBuster', name: 'Bunker Buster', cost: 16000, bundle: 2, arms: 3, cat: W, kind: 'buster', len: 42, r: 38, dmg: 170, ext: true },
    { id: 'empBlast', name: 'EMP Blast', cost: 11000, bundle: 3, arms: 2, cat: W, kind: 'emp', r: 60, ext: true, onShield: true },
    { id: 'portalGun', name: 'Portal Gun', cost: 15000, bundle: 2, arms: 2, cat: W, kind: 'portalgun', ext: true },

    { id: 'heatGuidance', name: 'Heat Guidance', cost: 10000, bundle: 6, arms: 2, cat: M, kind: 'guidance', code: 'Ht' },
    { id: 'ballisticGuidance', name: 'Bal Guidance', cost: 10000, bundle: 2, arms: 2, cat: M, kind: 'guidance', code: 'B', target: true },
    { id: 'horzGuidance', name: 'Horz Guidance', cost: 15000, bundle: 5, arms: 1, cat: M, kind: 'guidance', code: 'H', target: true },
    { id: 'vertGuidance', name: 'Vert Guidance', cost: 20000, bundle: 5, arms: 1, cat: M, kind: 'guidance', code: 'V', target: true },
    { id: 'lazyBoy', name: 'Lazy Boy', cost: 20000, bundle: 2, arms: 3, cat: M, kind: 'guidance', code: 'L', target: true },
    { id: 'parachute', name: 'Parachute', cost: 10000, bundle: 8, arms: 2, cat: M, kind: 'parachute' },
    { id: 'battery', name: 'Battery', cost: 5000, bundle: 10, arms: 2, cat: M, kind: 'battery' },
    { id: 'magDeflector', name: 'Mag Deflector', cost: 10000, bundle: 2, arms: 2, cat: M, kind: 'shield', code: 'Md', strength: 55, mag: 1, color: vga(63, 56, 10) },
    { id: 'shield', name: 'Shield', cost: 20000, bundle: 3, arms: 3, cat: M, kind: 'shield', code: 'Sh', strength: 110, color: vga(20, 44, 63) },
    { id: 'forceShield', name: 'Force Shield', cost: 25000, bundle: 3, arms: 3, cat: M, kind: 'shield', code: 'Fs', strength: 150, deflect: true, color: vga(56, 20, 63) },
    { id: 'heavyShield', name: 'Heavy Shield', cost: 30000, bundle: 2, arms: 4, cat: M, kind: 'shield', code: 'Hs', strength: 220, noFail: true, color: vga(63, 63, 63) },
    { id: 'superMag', name: 'Super Mag', cost: 40000, bundle: 2, arms: 4, cat: M, kind: 'shield', code: 'Sm', strength: 300, mag: 2, noFail: true, laserProof: true, color: vga(63, 24, 24) },
    { id: 'autoDefense', name: 'Auto Defense', cost: 1500, bundle: 1, arms: 3, cat: M, kind: 'autodefense' },
    { id: 'fuelTank', name: 'Fuel Tank', cost: 10000, bundle: 10, arms: 3, cat: M, kind: 'fuel' },
    { id: 'contactTrigger', name: 'Contact Trigger', cost: 1000, bundle: 25, arms: 3, cat: M, kind: 'trigger' }
  ];
  const byId = {};
  items.forEach((it, i) => { it.index = i; byId[it.id] = it; });
  const weapons = items.filter(i => i.cat === W);
  const misc = items.filter(i => i.cat === M);
  const shields = items.filter(i => i.kind === 'shield');
  const guidances = items.filter(i => i.kind === 'guidance');

  // weapons that no guidance system can steer (per the manual)
  const noGuidance = { mirv: 1, deathsHead: 1, riotCharge: 1, riotBlast: 1, plasmaBlast: 1, laser: 1 };

  const aiTypes = ['Moron', 'Shooter', 'Poolshark', 'Tosser', 'Chooser', 'Spoiler', 'Cyborg', 'Unknown'];
  const aiLabels = ['&Moron', '&Shooter', '&Poolshark', '&Tosser', '&Chooser', 'Spo&iler', 'C&yborg', '&Unknown'];

  const computerNames = [
    'Patton', 'Rommel', 'Napoleon', 'Custer', 'Hannibal', 'Caesar', 'Attila', 'Genghis', 'Zhukov',
    'Wellington', 'Nelson', 'Grant', 'Sherman', 'Bismarck', 'Saladin', 'Spartacus', 'Leonidas',
    'Montgomery', 'MacArthur', 'Bradley', 'Nimitz', 'Halsey', 'Sun Tzu', 'Alexander', 'Cromwell',
    'Boudica', 'Kutuzov', 'Moltke', 'Clausewitz', 'Xerxes', 'Cyrus', 'Ramses', 'Tamerlane',
    'Hector', 'Achilles', 'Ajax', 'Sarge', 'Gunner', 'Boomer', 'Sparky', 'Ace', 'Tex', 'Crusher',
    'Blaster', 'Rusty', 'Tiny', 'Duke', 'Major Tom', 'Kilroy', 'Mad Max', 'Sprocket', 'Dozer'
  ];

  // Built-in comment files (original lines written for this clone)
  const talkFiles = {
    'talk1.cfg': [
      'Incoming!', 'Special delivery!', 'Duck and cover!', 'Catch!', 'Bombs away!', 'Fire in the hole!',
      "Here's a little something for you.", "You're toast!", 'Knock knock.', 'This one has your name on it.',
      'Nothing personal.', 'Say goodnight.', 'Pardon my artillery.', "Hold still, this won't hurt a bit.",
      'Surprise!', 'Ready or not...', 'Take that!', 'Eat dirt!', 'Time to redecorate the landscape.',
      "I call this one 'The Crater'.", 'Look out below!', 'Have a nice day!', 'Air mail!',
      "It's raining steel!", 'One kaboom, coming right up.', 'I hope you have insurance.',
      'Smile for the camera!', "Don't take it personally.", 'Heads up!',
      'One order of destruction, to go.', 'Physics is on my side.', "Let's see you dodge this.",
      "Tag, you're it!", 'Compliments of the management.', 'I never miss. Well, rarely.',
      'Watch the birdie!', 'Mother always said I had a good arm.', 'Get off my lawn!',
      'Is this thing loaded?', 'Brace yourself.', 'From me, with love.', ''
    ],
    'talk2.cfg': [
      'Aaaaarrrgghhh!', "I'll be back... in pieces.", 'Not the treads!', 'Tell my turret I loved it.',
      'Is it hot in here?', 'Mommy!', 'Ouch.', 'Rust in peace.', 'I regret nothing!',
      'Was it something I said?', 'Bye-bye!', "That's gonna leave a mark.", "I didn't even get to fire!",
      'Curse you!', 'No fair!', 'I see a bright light...', 'Avenge me!', 'Why me?', 'Medic!',
      'My warranty just expired.', 'Farewell, cruel world!', 'Oof.', 'Not like this...', 'Good game!',
      'I was two days from retirement.', 'Scrap metal, here I come.', 'Oh, the humanity!',
      'Well, that was embarrassing.', 'Mayday! Mayday!', 'Tell my mother I tried.'
    ]
  };

  const playerColors = [
    vga(63, 12, 12),  // red
    vga(12, 58, 12),  // green
    vga(46, 18, 63),  // purple
    vga(63, 60, 12),  // yellow
    vga(12, 58, 63),  // cyan
    vga(63, 22, 50),  // magenta
    vga(58, 58, 58),  // white
    vga(63, 38, 6),   // orange
    vga(28, 38, 63),  // blue
    vga(42, 52, 24)   // olive
  ];
  const colorNames = ['Red', 'Green', 'Purple', 'Yellow', 'Cyan', 'Magenta', 'White', 'Orange', 'Blue', 'Olive'];

  // WIDE modes fill a 16:9 screen (the rest show 4:3, like a VGA monitor)
  // FIT SCREEN sizes the battlefield to the window (360x480's height and pixel shape)
  const graphicsModes = ['FIT SCREEN', '320x200', '320x240', '320x400', '320x480', '360x480', '480x480 WIDE', '640x400', '640x480', '854x480 WIDE', '800x600', '1024x768'];

  const defaults = {
    players: 2, rounds: 10,
    // Sound
    sound: true, flightSounds: 'OFF', soundStyle: 'REMASTERED', musicVolume: 60, sfxVolume: 100, windSound: false, boomStyle: 'FILM',
    // Hardware
    graphicsMode: '360x480', biosKeyboard: true, smallMemory: false, pointer: 'Mouse', mouseRate: 0.5,
    firingDelay: 100, fallingDelay: 10,
    // Economics
    interestRate: 0.05, cashAtStart: 0, computersBuy: true, freeMarket: false, scoringMode: 'STANDARD',
    // Physics
    airViscosity: 0, gravity: 0.2, suspendDirt: 0, tanksFall: true, bordersExtend: 75, effectOfWalls: 'NONE',
    // Landscape
    sky: 'RANDOM', maxWind: 200, changingWind: false, hostileEnvironment: true, skyGates: 'OFF', gateMotion: 'STAY',
    bumpiness: 20, slope: 20, flattenPeaks: false, randomLand: false, scannedMountains: 20,
    // Play options
    mode: 'SEQUENTIAL', teams: 'NONE', statusBar: false, playOrder: 'RANDOM', fastComputers: false, powerLimit: 'HALF',
    talkingTanks: 'OFF', talkProbability: 100, attackFile: 'talk1.cfg', dieFile: 'talk2.cfg',
    // Weapons
    armsLevel: 4, bombIcon: 'BIG', tunneling: true, scale: 'NORMAL', tracePaths: false, extraDirt: false,
    uselessItems: false, extendedArsenal: true,
    // Archaic (config file only in the original)
    impactDamage: true,
    // Remastered display and controls (personal settings: never sent to other players)
    quality: 'HIGH', screenShake: true, damageNumbers: true, tankLabels: 'BARS', killFeed: true,
    aimGuide: 'SHORT', dragAim: true, touchControls: 'AUTO', slowMotion: true,
    // remembered player setup
    lastPlayers: []
  };

  const pct = v => v + '%';
  const f2 = v => (Math.round(v * 100) / 100).toString().replace(/^0\./, '.');
  const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(Math.round(v * 100) / 100); return o; };

  // Option menus. type: toggle | cycle | num (steps) | text
  const menus = {
    sound: {
      title: 'Sound', items: [
        { key: 'sound', label: '&Sound', type: 'toggle' },
        { key: 'flightSounds', label: '&Flight Sounds', type: 'cycle', values: ['OFF', 'POS', 'VEL'] },
        { key: 'soundStyle', label: 'Sound S&tyle', type: 'cycle', values: ['REMASTERED', 'CLASSIC'] },
        { key: 'boomStyle', label: 'E&xplosions', type: 'cycle', values: ['FILM', 'ARCADE'], onChange: () => { Sound.pos(null); Sound.explosion(40); } },
        { key: 'windSound', label: '&Wind Sound', type: 'toggle' },
        { key: 'musicVolume', label: '&Music Volume', type: 'num', steps: range(0, 100, 5), fmt: pct },
        { key: 'sfxVolume', label: '&Effects Volume', type: 'num', steps: range(0, 100, 5), fmt: pct }
      ]
    },
    hardware: {
      title: 'Hardware', items: [
        { key: 'graphicsMode', label: '&Graphics Mode', type: 'cycle', values: graphicsModes },
        { key: 'biosKeyboard', label: '&Bios Keyboard', type: 'toggle' },
        { key: 'smallMemory', label: '&Small Memory', type: 'toggle' },
        { key: 'pointer', label: '&Pointer', type: 'cycle', values: ['None', 'Mouse', 'Joystick'] },
        { key: 'mouseRate', label: '&Mouse Rate', type: 'num', steps: range(0.5, 5, 0.5), fmt: v => v.toFixed(1) },
        { key: 'firingDelay', label: '&Firing Delay', type: 'num', steps: [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125, 150, 200, 250, 300, 400, 500] },
        { key: 'fallingDelay', label: 'F&alling Delay', type: 'num', steps: [0, 1, 2, 5, 10, 15, 20, 30, 50, 75, 100, 200, 500, 1000] }
      ]
    },
    economics: {
      title: 'Economics', items: [
        { key: 'interestRate', label: '&Interest Rate', type: 'num', steps: range(0, 0.30, 0.01), fmt: f2 },
        { key: 'cashAtStart', label: 'C&ash at Start', type: 'num', steps: [0, 5000, 10000, 20000, 30000, 50000, 75000, 100000, 150000, 200000, 250000, 300000, 400000, 500000, 750000, 1000000], fmt: money },
        { key: 'computersBuy', label: '&Computers Buy', type: 'toggle' },
        { key: 'freeMarket', label: '&Free Market', type: 'toggle' },
        { key: 'scoringMode', label: 'Scoring &Mode', type: 'cycle', values: ['BASIC', 'STANDARD', 'GREEDY'] }
      ]
    },
    physics: {
      title: 'Physics', items: [
        { key: 'airViscosity', label: 'Air &Viscosity', type: 'num', steps: range(0, 20, 1) },
        { key: 'gravity', label: '&Gravity', type: 'num', steps: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.5, 2, 3, 4, 5, 6, 8, 10], fmt: f2 },
        { key: 'suspendDirt', label: '&Suspend Dirt', type: 'num', steps: range(0, 100, 5), fmt: pct },
        { key: 'tanksFall', label: '&Tanks Fall', type: 'toggle' },
        { key: 'bordersExtend', label: '&Borders Extend', type: 'num', steps: [0, 10, 25, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, 5000, 10000] },
        { key: 'effectOfWalls', label: 'Effect of &Walls', type: 'cycle', values: ['NONE', 'CONCRETE', 'PADDED', 'RUBBER', 'SPRING', 'WRAP', 'RANDOM', 'ERRATIC'] }
      ]
    },
    landscape: {
      title: 'Landscape', items: [
        { key: 'sky', label: 'S&ky', type: 'cycle', values: ['PLAIN', 'STORMY', 'STARS', 'SHADED', 'SUNSET', 'CAVERN', 'BLACK', 'RANDOM'] },
        { key: 'maxWind', label: '&Max. Wind', type: 'num', steps: [0, 5, 10, 20, 30, 40, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500] },
        { key: 'changingWind', label: '&Changing Wind', type: 'toggle' },
        { key: 'hostileEnvironment', label: '&Hostile Environment', type: 'toggle' },
        { key: 'skyGates', label: 'Sky &Gates', type: 'cycle', values: ['OFF', 'FEW', 'MANY'] },
        { key: 'gateMotion', label: 'Gates M&ove', type: 'cycle', values: ['STAY', 'SHUFFLE'] },
        { key: 'bumpiness', label: '&Bumpiness', type: 'num', steps: range(0, 100, 5) },
        { key: 'slope', label: '&Slope', type: 'num', steps: range(0, 100, 5) },
        { key: 'flattenPeaks', label: '&Flatten Peaks', type: 'toggle' },
        { key: 'randomLand', label: '&Random Land', type: 'toggle' },
        { key: 'scannedMountains', label: '&Percent Scanned Mountains', type: 'num', steps: range(0, 100, 5), fmt: pct }
      ]
    },
    play: {
      title: 'Play Options', items: [
        { key: 'mode', label: '&Mode', type: 'cycle', values: ['SEQUENTIAL', 'SYNCHRONOUS', 'SIMULTANEOUS'] },
        { key: 'teams', label: 'T&eams', type: 'cycle', values: ['NONE', 'STANDARD', 'CORPORATE', 'VICIOUS'] },
        { key: 'statusBar', label: '&Status Bar', type: 'toggle' },
        { key: 'playOrder', label: 'Play &Order', type: 'cycle', values: ['RANDOM', 'LOSERS-FIRST', 'WINNERS-FIRST', 'ROUND-ROBIN'] },
        { key: 'fastComputers', label: '&Fast Computers', type: 'toggle' },
        { key: 'powerLimit', label: 'Power &Limit', type: 'cycle', values: ['ORIGINAL', 'HALF', 'OFF'] },
        { key: 'talkingTanks', label: '&Talking Tanks', type: 'cycle', values: ['OFF', 'COMPUTERS', 'ALL'] },
        { key: 'talkProbability', label: 'Talk &Probability', type: 'num', steps: range(0, 100, 5), fmt: pct },
        { key: 'attackFile', label: '&Attack File', type: 'text' },
        { key: 'dieFile', label: '&Die File', type: 'text' }
      ]
    },
    weapons: {
      title: 'Weapons', items: [
        { key: 'armsLevel', label: '&Arms Level', type: 'num', steps: [0, 1, 2, 3, 4] },
        { key: 'bombIcon', label: '&Bomb Icon', type: 'cycle', values: ['INVISIBLE', 'SMALL', 'BIG'] },
        { key: 'tunneling', label: '&Tunneling', type: 'toggle' },
        { key: 'scale', label: '&Scale', type: 'cycle', values: ['NORMAL', 'MEDIUM', 'LARGE'] },
        { key: 'tracePaths', label: 'Trace &Paths', type: 'toggle' },
        { key: 'extraDirt', label: '&Extra Dirt', type: 'toggle' },
        { key: 'uselessItems', label: '&Useless Items', type: 'toggle' },
        { key: 'extendedArsenal', label: 'E&xtended Arsenal', type: 'toggle' }
      ]
    }
  };

  menus.graphics = {
    title: 'Graphics', items: [
      { key: 'quality', label: '&Quality', type: 'cycle', values: ['HIGH', 'MEDIUM', 'LOW'] },
      { key: 'screenShake', label: 'Screen &Shake', type: 'toggle' },
      { key: 'slowMotion', label: 'Slow &Motion Finish', type: 'toggle' },
      { key: 'damageNumbers', label: '&Damage Numbers', type: 'toggle' },
      { key: 'tankLabels', label: 'Tank &Labels', type: 'cycle', values: ['BARS', 'NAMES', 'OFF'] },
      { key: 'killFeed', label: '&Kill Feed', type: 'toggle' },
      { key: 'aimGuide', label: '&Aim Guide', type: 'cycle', values: ['SHORT', 'FULL', 'OFF'] },
      { key: 'dragAim', label: 'D&rag to Aim', type: 'toggle' },
      { key: 'touchControls', label: '&Touch Controls', type: 'cycle', values: ['AUTO', 'ON', 'OFF'] }
    ]
  };

  const roundSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 300, 500, 750, 1000];

  return {
    items, byId, weapons, misc, shields, guidances, noGuidance, aiTypes, aiLabels, computerNames,
    talkFiles, playerColors, colorNames, graphicsModes, defaults, menus, roundSteps
  };
})();

/* ---------- live configuration (Save Changes persists it) ---------- */
const Cfg = Object.assign({}, Data.defaults, Store.get('scorch.cfg', {}));
function saveConfig() { return Store.set('scorch.cfg', Cfg); }
function scaleFactor() { return Cfg.scale === 'LARGE' ? 1.6 : Cfg.scale === 'MEDIUM' ? 1.3 : 1; }
