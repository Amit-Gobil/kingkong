'use strict';
/*
 * kingkong_cardata: Kingkong Tuning live values (tile "Kingkong") for iDrive 8.
 * Screens (1.2.0 Quiet Dials): drawn by the GPU renderer (mgu-renderd, scripts/renderd), designed in the HMI UI builder:
 * apps/hmi-ui-builder/projects/car-data.json, exported into this folder (rhmiData/ = one empty RHMI host state
 * per screen, renderer/ = screens.json + the builder's runtime). Tabs across the top of each screen (1.2.0):
 *   engine (entry): engine speed + boost (bars, peak hold), speed + gear, power + torque, oil /
 *                   coolant / intake air temperature
 *   details:        raw values per source, update rates, link status (for calibration)
 *   settings:       a slider per bar: where it ends (red zone = its last 10 %), saved in data/settings.json
 * The renderer gives the app the touches on its screens; the HMI's BACK / HOME / popups work through the host
 * states (screenapp.js bindHosts). Tyre pressure / temperature (1.0.13) dropped in 1.1.0, and the units /
 * bar scale menu of the RHMI screens: metric only.
 *
 * 1.0.6 (analysis/cardash-realtime.md): BMW's own data collector (oap-cdc-2018, config
 * someip.getIntervalsMs) reads rpm, speed, torque, sport-display data, accelerations and display
 * data by POLLING the getters, not by subscribing: those notifiers don't run (FES never fired here).
 * So bus values are polled (rpm every 50 ms) while the screen is in use; OBD (one TASU round trip per
 * request, too slow for rpm) is only the fallback and the source of boost / IAT / throttle. OBD asks
 * up to 6 PIDs per request and learns which PIDs the DME supports. Gear: estimated from rpm/speed.
 * 1.0.7 (car test of 1.0.6): power in hp, throttle = OBD relative throttle (0 = closed, '-' with the
 * engine off; absolute 0x11 read 38 % at rest), pedal = OBD relative pedal position (the bus pedal
 * signal read 100 % at a light touch: raw only, on the details screen). Drive mode row (never worked)
 * and the tiles view removed.
 * 1.0.13 (from idrive7-apps, analysis/idrive7-apps-merge.md): tyre pressure / temperature rows (TPMS,
 * getters polled like BMW's x_call), MDrive + FES boost (x0.01 bar, a guess) + timing / fuel pressures on
 * the details screen, boost from OBD PID 0x87 when the DME has it (PID 0x0B stops at 255 kPa = 1.5 bar
 * boost), and only TASU replies of the unit asked are taken (oap-dtcscan uses the same transport).
 * 1.0.14: misfire counts per cylinder this driving cycle (OBD service 06, MID A2.. TID 0C, cylinder count
 * from MID A0), one cylinder every 500 ms in the OBD rotation.
 * 1.1.3 (car: boost stuck at -0.03 .. -0.12 bar under load): boost = the highest fresh pressure of OBD PID 0x70
 * (boost pressure sensor), 0x87 and 0x0B, minus 0x33; all four on the details page. 1.1.4: "fresh" = 5 s (with one
 * PID per request 1.5 s dropped MAP and boost fell back to the sport display).
 * 1.1.5 (user): the driving page is gone (misfire counts were wrong, the cluster has its own G-meter), and with
 * it the misfire monitors (service 06), the acceleration getters and the throttle / pedal PIDs.
 * 1.1.8 (user): battery voltage, a fourth small bar beside the temperatures: Harman's LevelMonitor systemVoltage (the
 * head unit's supply, instance "Inst1"); the car's DME has no OBD PID 0x42. Not car-tested: unit picked by size.
 *
 * Sources (etc/oap/someip/someip-interfaces.json, instance "1" unless said):
 *   vehicle.CDS / Vehicle2          rpm, temps / speed
 *   drivingexcitement.FES           crankshaft torque, sport display (boost, g, power/torque %)
 *   displaydata.DisplayDataServer2  gear, rpm needle, power meter (cluster / HUD data)
 *   displaydataserver.DisplayDataServer  rpm, current gear (older variant)
 *   powertrain.AcceleratorPedal / Powertrain, infrastructure.VehicleInformation   pedal (raw) / gear display
 *   Harman environment.levelmonitor.LevelMonitor ("Inst1")   system voltage (battery)
 *   OBD service 0x01 to the DME (0x12), gear PID A4 also to the EGS (0x18), through TASU.
 * CAL: rpm x0.25, temps -48, outside x0.5-40 checked on the car; the rest are BMW signal-catalogue
 * style guesses, shown raw on the details screen to check them.
 *
 * 1.1.9: iDrive 7 + 8. Start, tile and shutdown are the shared OnlineApp host (oap-shared/online-host.js, the Store's
 * lifecycle); rhmiData/ has a host state per screen for both HMIs (builder bundle "both"). Polling and OBD run while a
 * screen shows (30 min after the last screen change at most) and stop when the app is hidden or closed.
 * 1.1.10: iDrive 7 draws its own layout of each page (screens.json screen.id7, 1:1 in iDrive 7 px, down to the
 * screen's bottom) instead of the iDrive 8 design scaled to the screen's width (which left the lower quarter empty).
 * 1.2.0: the Telemetry design (scripts/oap-tools/make_cardash_project.js): tabs across the top, Details as three key /
 * value columns, "DME not answering" in the frame without an engine speed. iDrive 8 only again (spec O1: the iDrive 7
 * layouts and uiDescription are gone; iDrive 7 cars keep 1.1.10).
 * 1.3.0: the pages ported from cauliflowermossgrape/idrive7-apps (MIT; renderer/kit/NOTICE), their values in tabs.js:
 * Fuel (the OBD values + the boost target 22 4AB0, each with its last 5 minutes), Trips (trips.js: every drive,
 * also with the screens closed while the app runs; data/trips.json), Transmission (transmission.js: read-only, the ZF
 * 8HP variants it knows), Details in groups (engine-groups.js). Their UDS reads share the OBD loop's TASU link
 * (udsRead). Engine: the peaks since the page opened (in the bars' labels); the engine-speed bar's end by the engine
 * type (Vehicle2 typeEngine) unless set by hand. Settings: fuel price, currency.
 * 1.4.0: DPF tab after Transmission (dpf.js, from 2bhacker9's DPF Monitor): soot against the regeneration point, km / fuel
 * since the last one, exhaust temperatures and differential pressure with their last 5 minutes, the engine unit's history;
 * 22 to the diesel engine unit (0x12) while the page shows. The tab is left out when the engine type says petrol.
 */
const someipBuilders                  = require('oap-sdk/src/someip/someipBuilders');
const fs = require('fs');
const path = require('path');
const obd = require('./obd.js');
const { Trips, FuelFlow, REFS, refLph } = require('./trips.js');
const groups = require('./engine-groups.js');
const transmission = require('./transmission.js');
const tabs = require('./tabs.js');
const dpf = require('./dpf.js');
const { createGuard } = require('./tasu-guard.js');
const { createHost } = require('./online-host.js');
const { RingLog } = require('./logbuf.js');
const ethMod = require('./ethanol.js');
const { createAdjust, isLiveAdjustWrite } = require('./adjust.js');

const LOG = '[kingkong_cardata]';

// ---- calibration knobs: raw bus value -> unit
const CAL = {
    rpm: (r) => r * 0.25,           // AVL_RPM_ENG_CRSH: raw 3624 at ~900 rpm cold idle
    kmh: (r) => r / 64,             // V_VEH_COG
    engineC: (r) => r - 48,         // coolant, engine oil
    outsideC: (r) => r * 0.5 - 40,  // TEMP_EX
    fesBoostBar: (r) => r * 0.01,   // sport display boost, idrive7-apps guess: compare with OBD on the details screen
    torqueNm: (r) => r * 0.5 - 1023.5,        // net crankshaft torque; 0 Nm at raw 2047, idle +37.5 (car-confirmed 2026-10-22)
    gearK: 23,                      // rpm per km/h in the 1:1 gear, start value for the gear estimate
};
const RENDER_MS      = 100;
const RPM_MS         = 50;          // getter polling: rpm sources (20 Hz, cluster-like)
const FAST_MS        = 100;         // getter polling: other fast values
const SLOW_MS        = 1000;
const RETRY_MS       = 30e3;        // services offered late (or never) get retried
const OBD_GAP_MS     = 10;          // pause between OBD requests (one in flight at a time)
const OBD_TIMEOUT_MS = 2000;
const FRESH_MS       = 1500;        // older values lose to another source
const OBD_FRESH_MS   = 5000;        // older OBD pressures don't count for boost (a source that stopped answering)
const OBD_KEEP_MS    = 30e3;        // older OBD values aren't shown at all (polling paused: no frozen numbers)
// ponytail: polling + OBD stop 30 min after the last tile tap (or at visible=false), reopen to resume
const ACTIVE_WINDOW_MS = 30 * 60e3;

const raw = {};         // latest bus values, unscaled
const seen = {};        // "Source.field" -> time of its last answer (changed or not)
const hits = {};        // "Source.field" -> changes in the current 5 s
const rates = {};
const errs = {};        // "Source.field" -> last error
const link = {};        // source -> 'connecting' | 'ok' | 'ERR ...'

const errText = (e) => String(e && e.message || e).slice(0, 60);
// link state after a failed connect: a service the car doesn't offer (its proxy never shows up, the SDK's
// "Proxy[..]::waitUntilAvailable(10000) timed out") is no error; read from the whole message (errText cuts it)
const linkErr = (e) => (/waitUntilAvailable\(\d*\) timed out/.test(String(e && e.message || e)) ? 'not offered' : `ERR ${errText(e)}`);
const hex = (b) => (b === undefined ? '--' : (b < 16 ? '0' : '') + b.toString(16).toUpperCase());
const valid = (r, invalid) => typeof r === 'number' && r !== invalid;
const busFresh = (f) => seen[f] && Date.now() - seen[f] < FRESH_MS;
function set(k, v) { raw[k] = v; }

const SOURCES = {   // name: [interface, { field: handler }, { field: poll ms }]
    CDS: ['de.bmw.infotainment.vehicle.CDS', {
        statusEngineSpeed2: (x) => set('rpm', x.actualValueRPMEngineCrankshaft),
        statusEngineTemperature: (x) => { set('coolant', x.temperatureEngineDrive); set('oil', x.temperatureEngineOilDrive); },
        statusEngineStatus: (x) => set('engineRun', x.statusEngineRunDrive),          // 1.3.0 Trips: MOTOR_AUS / _STARTET / _LAEUFT
    }, { statusEngineSpeed2: RPM_MS, statusEngineTemperature: SLOW_MS, statusEngineStatus: SLOW_MS }],
    Vehicle2: ['de.bmw.infotainment.vehicle.Vehicle2', {
        statusCarSpeed2: (x) => set('speed', x.speedVehicleCentreOfGravity),
        statusVehiclePartType: (x) => set('engineType', x.typeEngine),                // 1.3.0: diesel / petrol (read once)
    }, { statusCarSpeed2: FAST_MS }],
    FES: ['de.bmw.infotainment.drivingexcitement.FES', {
        statusActualValueTorque2: (x) => set('torque', x.actualValueTorqueCrankshaft),
        statusVehicleDynamicEngine: (x) => { set('torquePct', x.displaySportEngineTorque); set('powerPct', x.displaySportEnginePower); },
        statusVehicleDynamicEngineMaxValue: (x) => { set('maxPower', x.displayMaximumValuePower); set('maxTorque', x.displayMaximumValueTorque); },
        statusSwitchDriveDynamicSport2: (x) => {
            set('sportBoost', x.displayBoostPressure); set('sportBoostMax', x.displayMaximumValueBoostPressure);
            set('sportLat', x.displayLateralAcceleration); set('sportLon', x.displayLongitudinalAcceleration);
        },
        dataGearBox2: (x) => set('gearMode', x.driveModusGearbox),
    }, { statusActualValueTorque2: FAST_MS, statusVehicleDynamicEngine: FAST_MS,
        statusVehicleDynamicEngineMaxValue: 10e3, statusSwitchDriveDynamicSport2: FAST_MS }],
    Display: ['de.bmw.infotainment.displaydata.DisplayDataServer2', {
        functionalLibraryData: (x) => { set('ddsGear', x.gear); set('ddsRev', x.pointerPositionRevolution); set('ddsPower', x.powermeter && x.powermeter.pointerPosition); },
    }, { functionalLibraryData: RPM_MS }],
    DisplayOld: ['de.bmw.infotainment.displaydataserver.DisplayDataServer', {
        functionalLibraryData: (x) => { set('ddsRpm', x.rpm); set('ddsGearOld', x.currentGear); },
    }, { functionalLibraryData: FAST_MS }],
    Pedal: ['de.bmw.powertrain.AcceleratorPedal', {
        AngleAcceleratorPedal: (x) => set('pedal', x.actualValueAngleAcceleratorPedal),
    }],
    PT: ['de.bmw.powertrain.Powertrain', {
        dataDisplayGearboxSecure: (x) => { set('ptGear', x.dummy1); set('ptPos', x.dummy4); },
    }],
    Gearbox: ['de.bmw.infrastructure.VehicleInformation', {
        statusGearboxDrive: (x) => { set('viGear', x.statusActualGearDrive); set('viStage', x.statusActualStageDrive); },
    }],
    Env: ['de.bmw.infrastructure.EnvironmentalInformation', {
        ExteriorTemperature: (x) => set('outside', x.temperatureExterior),
    }],
    MDrive: ['de.bmw.infotainment.misc.MDrive', {
        statusMSystem: (x) => { set('awd', x.statusAllWheelSetup); set('awdQual', x.qualifierFunctionAllWheel); },
        dataDisplayGearbox: (x) => { set('program', x.displayProgramGearbox); set('driveLogic', x.displayDriveLogicGearbox); },
    }, { statusMSystem: SLOW_MS }],
    // 1.1.8: the head unit's own supply voltage (its KL30 input, ≈ the 12 V battery); instance 'Inst1' (someip-interfaces.json)
    Level: ['com.harman.infotainment.systeminfrastructure.environment.levelmonitor.LevelMonitor', {
        systemVoltage: (x) => set('volt', x.value),
    }, { systemVoltage: SLOW_MS }, 'Inst1'],
    // 1.3.0 Trips: the fuel injection signal (a counter: trips.js FuelFlow), the odometer and the tank
    CDS2: ['de.bmw.infotainment.vehicle.CDS2', {
        statusInjectionVolume: (x) => { set('injection', x.injectionVolumeFuelEngine); flow.feed(x.injectionVolumeFuelEngine, Date.now()); },
    }, { statusInjectionVolume: FAST_MS }],
    Kombi: ['de.bmw.infotainment.KombiIF', {
        statusRangeTankStatus: (x) => { set('tank', x.fluidLevelFuelTank); set('odo', x.mileageKilometre); },
    }, { statusRangeTankStatus: 10e3 }],
};
// polled also while no screen shows (the rest only while one does): what the trip computer counts
const ALWAYS = ['Vehicle2.statusCarSpeed2', 'CDS.statusEngineStatus', 'CDS2.statusInjectionVolume', 'Kombi.statusRangeTankStatus'];

// ---- values in metric units (undefined = no data) -------------------------------------------
const o = {};           // OBD key -> { value, at } | { err }
const obdVal = (k) => (o[k] && 'value' in o[k] && Date.now() - o[k].at < OBD_KEEP_MS ? o[k].value : undefined);
// one PID per request (multi off): each fast PID comes round only every ~12 requests
const obdFresh = (k) => o[k] && 'value' in o[k] && Date.now() - o[k].at < OBD_FRESH_MS;
const busC = (r, cal) => (valid(r, 255) ? cal(r) : undefined);
let gearK = CAL.gearK;
const boostTgt = { kpa: null, at: 0 };   // the boost target from 22 4AB0 (absolute kPa): Fuel
const ethanol = ethMod.createEthanol();  // MHD Active (5939) then 5938 / OBD52 / 550D
let ethObdQueued = false, ethUdsTurn = 0;
const V = {
    // the bus while it answers (polled every 50-100 ms), OBD (a round trip per value) only as fallback
    rpm: () => (busFresh('CDS.statusEngineSpeed2') && valid(raw.rpm, 65535) ? CAL.rpm(raw.rpm) : obdVal('rpm')),
    speed: () => (busFresh('Vehicle2.statusCarSpeed2') && valid(raw.speed, 65535) ? CAL.kmh(raw.speed) : obdVal('speed')),
    // OBD: the highest fresh boost / manifold pressure (PID 0x70 boost sensor, 0x87, 0x0B - one of them may never
    // pass the outside pressure, car 1.1.2) - outside pressure; else the sport display
    boost: () => {
        const ps = ['boostP', 'mapX', 'map'].filter(obdFresh).map(obdVal).filter((v) => v !== undefined);
        if (ps.length && obdVal('baro') !== undefined) return (Math.max.apply(null, ps) - obdVal('baro')) / 100;
        return V.fesBoost();
    },
    fesBoost: () => (valid(raw.sportBoost, 255) ? CAL.fesBoostBar(raw.sportBoost) : undefined),
    torque: () => (busFresh('FES.statusActualValueTorque2') && valid(raw.torque, 65535) ? CAL.torqueNm(raw.torque)
        : obdVal('torquePct') !== undefined && obdVal('refTorque') ? obdVal('torquePct') * obdVal('refTorque') / 100 : undefined),
    power: () => (V.torque() !== undefined && V.rpm() !== undefined ? V.torque() * V.rpm() / 9549.3 : undefined),   // kW
    iat: () => obdVal('iat'),
    coolant: () => busC(raw.coolant, CAL.engineC),
    oil: () => busC(raw.oil, CAL.engineC),
    outside: () => busC(raw.outside, CAL.outsideC),
    odo: () => (valid(raw.odo, 16777215) ? raw.odo : undefined),
    tank: () => (valid(raw.tank, 255) ? raw.tank : undefined),
    // the boost target: 22 4AB0 while fresh, else OBD 0x70's commanded pressure; minus the outside pressure, in bar
    ethanol: () => ethMod.value(ethanol),
    boostT: () => {
        const abs = Date.now() - boostTgt.at < 3000 ? boostTgt.kpa : obdFresh('boostT') ? obdVal('boostT') : undefined;
        return abs === undefined || abs === null || obdVal('baro') === undefined ? undefined : (abs - obdVal('baro')) / 100;
    },
    // ponytail: the unit isn't documented - mV, 10 mV, 100 mV and V each put 6-16 V in their own range, so the size
    // of the number picks it; the details page shows the raw value to check it against
    volt: () => {
        const r = raw.volt;
        if (!(typeof r === 'number' && r > 0) || !(Date.now() - (seen['Level.systemVoltage'] || 0) < 5000)) return undefined;
        return r >= 5000 ? r / 1000 : r >= 500 ? r / 100 : r >= 50 ? r / 10 : r;
    },
};

// gear sources, best first:
// 1. VehicleInformation.statusGearboxDrive.statusActualGearDrive - authoritative, the cluster's own gear.
//    ID8 catalogue enum (= idrive7-apps): R=1, N_OR_P=2, G1=3 … G10=12 (forward gear = value - 2). The SDK
//    hands enums back as the NAME ("G5", "R") or the number, so decode both. Event-only (no getter): it
//    fires on a change, so raw.viGear is the last gear seen; undefined until the first shift -> fall through.
//    statusActualStageDrive gives the selector (P=1,R=2,N=3,D=4) for standstill / neutral.
// 2. DisplayDataServer2 `gear` (ddsGear), encoded +19 (car-confirmed 2026-10-22: 20 = 1st … 27 = 8th).
// 3. rpm/speed estimate (8HP ratios).
const GEARNAME = { R: 'R', N_OR_P: 'N/P', G1: '1', G2: '2', G3: '3', G4: '4', G5: '5', G6: '6', G7: '7', G8: '8', G9: '9', G10: '10' };
const STAGENAME = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' };
// -> 'R' / '1'..'10' / null (N/P, unknown, error); number 1=R,2=N/P,3..12=gears or the enum name string
function gearOf(v) {
    if (typeof v === 'number') return v === 1 ? 'R' : (v >= 3 && v <= 12 ? String(v - 2) : null);
    const g = GEARNAME[v];
    return g && g !== 'N/P' ? g : null;
}
function gearText() {
    const g = gearOf(raw.viGear);
    if (g) return g;                                                 // authoritative engaged gear
    const stage = STAGENAME[raw.viStage];
    if (stage && stage !== 'D') return stage;                        // P / R / N at standstill (D with no gear falls through)
    const moving = V.speed() > 0;
    if (moving && typeof raw.ddsGear === 'number' && raw.ddsGear >= 20 && raw.ddsGear <= 27) return String(raw.ddsGear - 19);
    if (!moving) return stage || '-';
    const est = obd.estimateGear(V.rpm(), V.speed(), gearK);
    gearK = est.k;
    return est.gear ? String(est.gear) : '-';
}
// Vehicle2 statusVehiclePartType.typeEngine (a name or its number) -> 'diesel' | 'petrol' | undefined
// (cauliflowermossgrape/idrive7-apps kit/runtime/engine.js TYPES, MIT)
const ENGINE_TYPES = { 4: 'petrol', 5: 'petrol', 6: 'diesel', 7: 'diesel', 8: 'petrol', 9: 'petrol', BENZIN_DIREKTEINSPRITZUNG: 'petrol',
    BENZIN_KONVENTIONELL: 'petrol', DIESEL_DIREKTEINSPRITZUNG: 'diesel', DIESEL_KONVENTIONELL: 'diesel', ELEKTROMOTOR: 'petrol', HYBRIDMOTOR: 'petrol' };
const engineType = () => (Object.prototype.hasOwnProperty.call(ENGINE_TYPES, raw.engineType) ? ENGINE_TYPES[raw.engineType] : undefined);
// the engine runs: CDS statusEngineStatus (read every second; older than 5 s = the source stopped: not taken, or a
// trip would never end), else the engine speed while one comes; undefined = not known
const RUN = { MOTOR_AUS: 'off', MOTOR_STARTET: 'starting', MOTOR_LAEUFT: 'running', 0: 'off', 1: 'starting', 2: 'running' };
const engineRun = () => (Date.now() - (seen['CDS.statusEngineStatus'] || 0) < 5000 && RUN[raw.engineRun])
    || (V.rpm() > 300 ? 'running' : V.rpm() !== undefined ? 'off' : undefined);

// ---- Details · Data links (beside the engine unit's groups): the sources, the OBD PIDs, the update rates -------------
const num = (v, d = 0) => (v === undefined || isNaN(v) ? '-' : v.toFixed(d));
function linkRows() {
    // a short reason, not the error cut mid-word (1.2.0): the first failing source ('error', red), else the first one
    // that is not ok (dim: connecting / not offered)
    const err = (n) => /^ERR/.test(link[n] || '');
    const names = Object.keys(link), bad = names.find(err) || names.find((n) => link[n] !== 'ok');
    const pids = (t) => (!supported[t] ? '?' : !supported[t].length ? 'none'
        : supported[t].slice(0, 11).map(hex).join(' ') + (supported[t].length > 11 ? ' …' : ''));
    const rate = (k) => `${num(rates[k] || 0, 1)}/s`;
    return [['Sources', bad ? `${bad} ${err(bad) ? 'error' : link[bad]}` : 'all ok', bad ? (err(bad) ? 'crit' : 'dim') : 'ok'],
        ['OBD PIDs (DME)', pids(DME)], ['OBD PIDs (EGS)', pids(EGS)],
        ['Updates', `rpm ${rate('CDS.statusEngineSpeed2')} · speed ${rate('Vehicle2.statusCarSpeed2')}`]];
}

// ---- SOME/IP sources: subscribe everything, poll the getters of the fast fields --------------
function connect(name) {
    const [ifName, fields, polled = {}, instance = '1'] = SOURCES[name];
    link[name] = link[name] || 'connecting';
    let proxy = null;
    const last = {};
    const update = (field) => (x) => {
        if (x === undefined || x === null) return;
        seen[`${name}.${field}`] = Date.now();
        const s = JSON.stringify(x);
        if (s === last[field]) return;
        last[field] = s;
        fields[field](x);
        hits[`${name}.${field}`] = (hits[`${name}.${field}`] || 0) + 1;
    };
    const read = (field) => Promise.resolve().then(() => proxy[field].getValue())
        .then(update(field), (e) => { errs[`${name}.${field}`] = errText(e); });
    const poll = (field, ms) => {
        // the trip computer's fields also while no screen shows, then every 500 ms at most (the others keep their pace:
        // the rpm getter answers within 50 ms of a tile tap)
        const always = ALWAYS.indexOf(`${name}.${field}`) >= 0;
        const go = () => (always || Date.now() < activeUntil ? read(field) : Promise.resolve())
            .then(() => setTimeout(go, always && Date.now() >= activeUntil ? Math.max(ms, 500) : ms));
        go();
    };
    return someipBuilders.buildAndInitTypedProxy(ifName, instance, { timeoutMs: 10000 })
        .then((p) => { proxy = p; })
        .then(() => Promise.all(Object.keys(fields).map((field) => Promise.resolve()
            .then(() => proxy[field].subscribe(update(field)))
            .catch((e) => { errs[`${name}.${field}`] = `subscribe ${errText(e)}`; })
            .then(() => (proxy[field] && typeof proxy[field].getValue === 'function' ? read(field) : null)))))
        .then(() => {
            link[name] = 'ok';
            // (a field this head unit's interface lacks: left out - its subscribe error is in errs - the others go on)
            Object.keys(polled).forEach((field) => { if (proxy[field] && typeof proxy[field].getValue === 'function') poll(field, polled[field]); });
        })
        .catch((e) => {
            link[name] = linkErr(e);
            setTimeout(() => connect(name), RETRY_MS);
        });
}

// ---- OBD through TASU -----------------------------------------------------------------------
const TASU_IF = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
const TESTER  = 0xF2;   // stock source address
const DME     = 0x12;
const EGS     = 0x18;
// rpm, boost, map, speed
function fastPids() {
    const has = (p) => supported[DME] && usablePid(DME, p);
    const noMapX = o.mapX && 'value' in o.mapX && o.mapX.value === undefined;   // 0x87 listed, sensor A missing
    return [0x0C, has(0x70) ? 0x70 : null, has(0x87) && !noMapX ? 0x87 : 0x0B, 0x0D]
        .filter((p) => p !== null && usablePid(DME, p));
}
// 0x0B here too: with 0x87 in the fast set, both MAP PIDs show on the details page (and count for boost)
const SLOW_PIDS = [0x0F, 0x33, 0x0B, 0x05, 0x5C, 0x04, 0x0E, 0x10, 0x61, 0x62, 0x63, 0x46, 0xA4, 0x23, 0x0A, 0x5E, 0x52];   // 0x52: etanol (Reflex/CAN via DME); 0x5E fuel ref
const supported = {};   // target -> [pid] once asked
const refused = new Set();          // "target:pid" the ECU refused: not asked again
let tasu = null;
let activeUntil = 0;
let activeSince = 0;    // when polling last resumed (after a pause)
let multi = true;       // several PIDs per request; off after the DME refuses it
let slowNext = 0;
let fastTurn = true;
let pending = null;     // { target, pids, timer }
const queue = [];       // one-off requests: supported-PID scans
const udsQueue = [];    // the pages' UDS reads (22 to the DME / the gearbox unit): { target, uds, resolve }
let udsTurn = false;    // while any wait: every other request is one of them
let obdCount = 0;

const usablePid = (t, pid) => !refused.has(`${t}:${pid}`) && (!supported[t] || supported[t].indexOf(pid) >= 0);
function nextRequest() {
    if (queue.length) return queue.shift();
    if (udsQueue.length && (udsTurn = !udsTurn)) return udsQueue.shift();
    fastTurn = !fastTurn;
    if (!fastTurn) {    // every other request: the next slow PIDs (gear A4 also from the EGS)
        const list = SLOW_PIDS.filter((p) => usablePid(DME, p));
        const egsGear = supported[EGS] && usablePid(EGS, 0xA4) && slowNext % 4 === 0;
        slowNext++;
        if (egsGear) return { target: EGS, pids: [0xA4] };
        if (list.length) {
            const n = multi ? Math.min(6, list.length) : 1, start = (slowNext * n) % list.length;
            return { target: DME, pids: list.concat(list).slice(start, start + n) };
        }
    }
    const fast = fastPids();
    return { target: DME, pids: multi ? fast : [fast[obdCount % fast.length]] };
}

function connectTasu() {
    link.UDS = link.UDS || 'connecting';
    return someipBuilders.buildAndInitTypedProxy(TASU_IF, 'SystemFunctionsInternalTasuInst1', { timeoutMs: 10000 })
        .then((proxy) => proxy.sendTasuResponse.subscribe(onTasuResponse).then(() => {
            tasu = proxy; link.UDS = 'ok';
            queue.push({ target: DME, pids: obd.SUPPORT }, { target: EGS, pids: [0x00, 0xA0] });
        }))
        .catch((e) => { link.UDS = linkErr(e); setTimeout(connectTasu, RETRY_MS); });
}

/** A page's read/write through the TASU link (one request in flight, between the OBD requests): resolves the unit's
 *  answer from its service byte (62 ... / 6F ... / 41 ... / 7F ...) as bytes, or null (no link, no answer, blocked) */
function udsRead(target, bytes) {
    if (!tasu) return Promise.resolve(null);
    return new Promise((resolve) => {
        udsQueue.push({ target, uds: Array.from(bytes), resolve });
        if (!pending) setTimeout(obdTick, 0);
    });
}
// Adjust tab (maps / Max Cooling / flap): shares this TASU queue; created after udsRead exists
let adjust = null;
function ensureAdjust() {
    if (!adjust) adjust = createAdjust({ uds: (t, b) => udsRead(t, b), log: (m) => log(m) });
    return adjust;
}

function finishObd(answer) {
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.uds) { const u = pending; pending = null; u.resolve(answer.uds || null); setTimeout(obdTick, OBD_GAP_MS); return; }
    const { target, pids } = pending;
    pending = null;
    obdCount++;
    hits.OBD = (hits.OBD || 0) + 1;
    if (answer.err) {
        if (pids && pids.indexOf(0x52) >= 0) { ethObdQueued = false; ethanol.debug.obd52 = 'err ' + String(answer.err).slice(0, 48); }
        if (pids.length > 1 && pids[0] !== 0x00 && /NRC|timeout/.test(answer.err)) multi = false;
        else if (/NRC 7F 01 (12|31)/.test(answer.err)) pids.forEach((p) => { if (p !== 0x52) refused.add(target + ':' + p); });
        if (target === DME && pids.length === 1 && pids[0] !== 0x52) o[obd.key(pids[0])] = { err: answer.err };
        if (pids[0] === 0x00) supported[target] = supported[target] || [];   // ECU has no OBD: ask nothing more
    } else {
        if (pids && pids.indexOf(0x52) >= 0) ethObdQueued = false;
        if (answer.supported.length || pids[0] === 0x00) supported[target] = answer.supported;
        Object.keys(answer.values).forEach((k) => { o[k] = { value: answer.values[k], at: Date.now() }; });
        // Reflex/ECA CAN → MHD → OBD 0x52 (raw byte; ethanol.js decodes)
        if (typeof answer.values.ethanol === 'number') ethMod.fromObd52Byte(answer.values.ethanol, ethanol);
    }
    setTimeout(obdTick, OBD_GAP_MS);
}

// every TASU request passes the shared guard. Reads (OBD 01, UDS 22, …) always pass. Live Adjust's MHD /
// flap 2F writes are allowed at any speed (same allow-list as Iterio liveadjust 1.1.1); anything else still
// needs the car parked (and fails here because speed/rpm are not fed — intentional).
const still = createGuard({ engineRunning: true, freshMs: 5000 });
const guard = Object.assign({}, still, {
    check: (sid, d) => (isLiveAdjustWrite(sid, d) ? { ok: true, why: '' } : still.check(sid, d)),
});

function obdTick() {
    if (!tasu || pending || Date.now() > activeUntil) return;
    const req = nextRequest();
    pending = Object.assign({ timer: setTimeout(() => finishObd({ err: 'timeout' }), OBD_TIMEOUT_MS) }, req);
    const sid = req.uds ? req.uds[0] : 0x01, data = req.uds ? req.uds.slice(1) : req.pids;
    const g = guard.check(sid, data);
    if (!g.ok) { finishObd({ err: `blocked: ${g.why}` }); return; }
    tasu.sendTasuRequest({
        sourceAddress: TESTER, targetAddress: req.target, serviceID: sid, subroutineID: 0,
        udsDataLength: data.length, udsData: Buffer.from(data), deadlockTime: 0,
    }).then((res) => {
        const code = res && res.TasuErrorEnum;
        if (code !== 'NO_ERROR' && code !== 'REQUEST_PENDING') finishObd({ err: String(code) });
    }, (e) => finishObd({ err: errText(e) }));
}

// Layout as parsed by the stock app: [2] == 0x7F -> TAS error code at [4]; [6] = the unit that
// answered; its answer starts at [9]: 41 PID data [PID data]... or 7F 01 NRC. Every TASU user gets
// every reply (oap-dtcscan scans all units): only the asked unit's service 01 answers are ours.
function onTasuResponse(ev) {
    if (!pending) return null;
    if (!ev || ev.errorCode !== 'NO_ERROR') return finishObd({ err: String(ev && ev.errorCode) });
    const r = Array.from(ev.udsResponse || []);
    if (r[2] === 0x7F) return finishObd({ err: `TAS ${hex(r[4])}` });
    if (r[6] !== pending.target) return null;
    if (pending.uds) {                   // a page's read: its answer, or its refusal (7F; 78 = wait for the answer)
        const q = pending.uds, sid = q[0];
        // a 62 must name the DID asked: a late reply to the read before is not this one's answer
        const mine = r[9] === sid + 0x40 && (sid !== 0x22 || (r[10] === q[1] && r[11] === q[2]));
        return mine || (r[9] === 0x7F && r[10] === sid && r[11] !== 0x78) ? finishObd({ uds: r.slice(9) }) : null;
    }
    if (r[9] === 0x41) return finishObd(obd.parse(r.slice(10)));
    if (r[9] === 0x7F && r[10] === 0x01) return r[11] === 0x78 ? null : finishObd({ err: `NRC ${r.slice(9, 12).map(hex).join(' ')}` });
    return null;
}

// ---- screens (the renderer) -------------------------------------------------------------------
// renderer/ is the builder's export: screens.json + its runtime. Loaded with a computed path (plain files in the
// package). The linked bundle is javascript/app.js: the package root is one up.
const SOURCE = typeof __dirname === 'string' ? path.join(__dirname, '..') : `/var/opt/public/oap/oap_${process.getuid()}/source`;
const RENDERER = path.join(SOURCE, 'renderer');
const runtime = (f) => require(path.join(RENDERER, f));
const PAGES = ['engine', 'fuel', 'trips', 'transmission', 'dpf', 'adjust', 'details', 'settings'];   // RHMI host states
const TAB = { engine: 'Engine', fuel: 'Fuel', trips: 'Trips', transmission: 'Transmission', dpf: 'DPF',
    adjust: 'Adjust', details: 'Details', settings: 'Settings' };
// Flip to true to restore Trips / Details in the tab bar (screens + logic stay shipped either way).
// Keep in sync with tools/pack-cardata.js SHOW_TRIPS_DETAILS.
const SHOW_TRIPS_DETAILS = false;
// Kingkong tabs: Engine / Fuel / [Trips] / Transmission / Adjust / [Details] / Settings
const shownPages = () => ['engine', 'fuel']
    .concat(SHOW_TRIPS_DETAILS ? ['trips'] : [])
    .concat(['transmission', 'adjust'])
    .concat(SHOW_TRIPS_DETAILS ? ['details'] : [])
    .concat(['settings']);
let screens = null, tabsShown = '';
function syncTabs() {          // bottom teleTabBar + shell (tabs hidden up top)
    const s = shownPages(), t = s.map((p) => TAB[p]).join(', ');
    tabsShown = t;
    PAGES.forEach((p) => {
        const sel = Math.max(0, s.indexOf(p));
        screens.set(`${p}Menu`, { tabs: t, sel, hideTabs: true });
        screens.set(`${p}Tabs`, { tabs: t, sel });
    });
}

// ---- settings: where each bar ends (the settings page's sliders), saved in the app's data folder ----------
// The red zone is the last 10 % of a bar (user decision); the torque bar ends where the slider says, whatever
// rated torque the car reports. key: [default, slider lowest, highest, step]; settings row = <key>Max.
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');   // the app's data folder (the Store's)
const ring = new RingLog(DATA_DIR);
const RANGES = { rpm: [8000, 5000, 10000, 500], boost: [2.5, 0.5, 4, 0.25], power: [500, 200, 1500, 50], torque: [700, 300, 1700, 50],
    oil: [150, 100, 180, 5], coolant: [130, 100, 160, 5], intake: [80, 40, 120, 5] };
const UNITS = { rpm: 'rpm', boost: 'bar', power: 'hp', torque: 'Nm' };     // the bars with a red zone
const snap = (k, v) => { const [def, lo, hi, st] = RANGES[k]; return isFinite(v) ? +Math.min(hi, Math.max(lo, Math.round(v / st) * st)).toFixed(2) : def; };
// the bar ends set by hand (Settings); the others follow their default - the engine-speed bar's by the engine type (a
// diesel 6000 rpm, else 8000; spec 5). An older settings.json holds every end: they all count as set by hand.
const CURRENCIES = ['EUR', 'USD', 'CAD', 'GBP', 'CHF', 'PLN', 'CZK', 'SEK', 'NOK', 'DKK', 'HUF', 'UAH'];   // idrive7-apps Live Data's
let custom = {}, currency = 'SEK', fuelK = null, dpfLearned = [];
try {
    const f = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    Object.keys(RANGES).forEach((k) => { if (k in f) custom[k] = snap(k, +f[k]); });
    if (CURRENCIES.indexOf(f.currency) >= 0) currency = f.currency;
    if (f.fuelK > 0) fuelK = f.fuelK;
    dpfLearned = f.dpfLearned || [];
} catch (e) { /* defaults */ }
const endOf = (k) => (k in custom ? custom[k] : k === 'rpm' && engineType() === 'diesel' ? 6000 : RANGES[k][0]);
const ends = {};
const refreshEnds = () => Object.keys(RANGES).forEach((k) => { ends[k] = endOf(k); });
refreshEnds();
const redFrom = (k) => +(ends[k] * 0.9).toFixed(2);
let saveTimer = null;
function saveSettings() {   // a slider drag changes it many times: written once it rests
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(Object.assign({}, custom, { currency, fuelK: flow.k, dpfLearned: filt.learned }))); }
        catch (e) { log(`settings not saved: ${errText(e)}`); }
    }, 500);
}
const flow = new FuelFlow(fuelK);   // Trips' fuel signal; its scale learned per car (kept as fuelK)
const filt = new dpf.Filter(dpfLearned);   // DPF: where this car's regenerations start, learned (kept as dpfLearned)

const rnd = (v, d) => (v === undefined || isNaN(v) ? undefined : +v.toFixed(d || 0));   // as shown: fewer redraws
let peaks = {};
/** the highest value since the Engine page opened (the bar's peak mark and "peak" in its label; spec 5) */
function peak(k, v) {
    if (v !== undefined && !(peaks[k] >= v)) peaks[k] = v;
    return peaks[k];
}
const LABEL = { rpm: ['RPM', 0], boost: ['Boost', 2], hp: ['Power', 0], nm: ['Torque', 0] };
const withPeak = (k) => (peaks[k] === undefined ? LABEL[k][0] : `${LABEL[k][0]} · peak ${peaks[k].toFixed(LABEL[k][1])}`);
// "D3" in D with a known gear (the reference design), else the gear / selector as gearText gives it
function gearShown() {
    const g = gearText();
    return /^\d+$/.test(g) && STAGENAME[raw.viStage] === 'D' ? `D${g}` : g;
}

// ---- Trips (trips.js): every drive, also with the screens closed while the app runs; data/trips.json ----------------
const TRIPS_FILE = path.join(__dirname, '..', '..', 'data', 'trips.json');
let tc;
try { tc = Trips.fromJSON(JSON.parse(fs.readFileSync(TRIPS_FILE, 'utf8')), Date.now()); } catch (e) { tc = Trips.fromJSON(null, Date.now()); }
let tripsSaved = -1, tripsSavedAt = 0, tripPeriod = 1;   // the page opens on 7 days
function saveTrips() {        // written aside, then renamed: a power cut keeps the last whole file
    try {
        fs.writeFileSync(`${TRIPS_FILE}.tmp`, JSON.stringify(tc));
        fs.renameSync(`${TRIPS_FILE}.tmp`, TRIPS_FILE);
        tripsSaved = tc.ver; tripsSavedAt = Date.now();
    } catch (e) { log(`trips not saved: ${errText(e)}`); }
}
// the engine unit's own fuel figure (trips.js REFS, in that order: 22 5656, OBD 5E, 22 4521 - the first it gives), read
// every second while a screen shows and the engine runs: it scales the fuel signal (FuelFlow.learn; the scale kept in
// settings.json) and stands in for it until then
const fuelRef = { lph: null, src: null, at: 0 };
const udsRefused = new Set();       // what the DME refused (7F): not asked again
const asking = new Set();           // asked every second, an unanswered read waits 2 s: one of each in flight
function askDme(key, bytes, done) {
    if (asking.has(key)) return;
    asking.add(key);
    const free = () => { asking.delete(key); };
    udsRead(DME, bytes).then(done).then(free, free);
}
function gotFuelRef(lph, src) {
    if (typeof lph !== 'number' || !isFinite(lph)) return;
    Object.assign(fuelRef, { lph, src, at: Date.now() });
    if (flow.learn(lph, Date.now())) saveSettings();
}
function readFuelRef() {
    if (!tasu || Date.now() > activeUntil || engineRun() !== 'running') return;
    const r = REFS.find((x) => !udsRefused.has(x.src));
    if (!r) return;
    if (r.src === 'OBD 5E') {       // asked by the OBD loop while the DME lists it and has not refused it
        if (supported[DME] && !usablePid(DME, 0x5E)) udsRefused.add(r.src);
        else if (obdFresh('fuelRate')) gotFuelRef(obdVal('fuelRate'), r.src);
        return;
    }
    const did = parseInt(r.src, 16);
    askDme(r.src, [0x22, did >> 8, did & 255], (u) => {
        if (u && u[0] === 0x7F) udsRefused.add(r.src);
        else if (u) gotFuelRef(refLph(r.src, u.slice(3)), r.src);
    });
}
function tripFuel(now) {     // l/h: the fuel signal once its scale is learned, else the engine unit's figure while fresh
    const s = flow.lph(now);
    if (s !== null) return { lph: s, src: 'signal' };
    return now - fuelRef.at < 3000 ? { lph: fuelRef.lph, src: fuelRef.src } : { lph: null, src: null };
}
function tripFlow(now) {     // Trips' chip: l/h now and l/100 km (null: standing)
    const f = tripFuel(now), v = V.speed();
    return f.lph === null ? null : { lph: f.lph, per100: v >= 5 ? f.lph / v * 100 : null };
}
function tripTick() {
    const now = Date.now(), f = tripFuel(now);
    const r = tc.feed(now, { speed: V.speed(), lph: f.lph, src: f.src, running: engineRun(), odo: V.odo(), tank: V.tank() });
    if (r.started) log(`trip started, fuel from ${f.src || 'nothing yet'}`);
    if (r.ended) log(`trip ended: ${r.ended.km.toFixed(1)} km, ${r.ended.l.toFixed(2)} l`);
    if (r.started || r.ended || (tc.ver !== tripsSaved && now - tripsSavedAt > 30e3)) saveTrips();   // spec 6: every 30 s
}

// ---- Fuel: each value every 5 s for its last 5 minutes (60), while a screen shows (the OBD loop runs then) ------
const series = { iat: [], heat: [], hpfp: [], lpfp: [], timing: [], boost: [], boostT: [] };
function fuelNow() {
    const out = V.outside() !== undefined ? V.outside() : obdVal('ambient'), iat = V.iat();
    return { iat, heat: iat !== undefined && out !== undefined ? iat - out : undefined, hpfp: obdVal('hpfp'), lpfp: obdVal('lpfp'),
        timing: obdVal('timing'), boost: V.boost(), boostT: V.boostT() };
}
function sampleSeries() {
    if (Date.now() > activeUntil) return;
    const v = fuelNow();
    Object.keys(series).forEach((k) => {
        if (typeof v[k] !== 'number' || !isFinite(v[k])) return;
        series[k].push(v[k]);
        if (series[k].length > 60) series[k].shift();
    });
}
const onPage = (n) => !!(screens && screens.st && screens.st.name === n) && Date.now() <= activeUntil;
// the boost target (22 4AB0: 1/256 kPa, absolute; spec 6, as M Vitals) every second while Fuel shows
function readBoostTarget() {
    if (!onPage('fuel') || udsRefused.has('4AB0')) return;
    askDme('4AB0', [0x22, 0x4A, 0xB0], (u) => {
        if (u && u[0] === 0x7F) udsRefused.add('4AB0');
        else if (u && u.length >= 5) Object.assign(boostTgt, { kpa: (u[3] * 256 + u[4]) / 256, at: Date.now() });
    });
}

// ---- Details: the engine unit's values in groups (engine-groups.js), pass after pass while the page shows ----------
const GROUP_DIDS = (() => {      // the catalog's identifiers: the first pass's progress counts against them
    const s = new Set();
    groups.CATALOG.groups.forEach((g) => g.items.forEach((it) => (it.c || []).concat(it.minus || []).forEach((c) => s.add(c.did))));
    return s.size;
})();
let groupsRes = null, groupsAsked = 0, groupsBusy = false;

// Low pressure fuel: OBD 0x0A often missing on S58 — try UDS 58F3 (kPa×0.1) then 5463 (hPa)
let lpfpUdsTurn = 0;
function readLpfp() {
    if (Date.now() > activeUntil) return;
    if (obdFresh('lpfp') && typeof obdVal('lpfp') === 'number') return;
    if (!tasu || (!onPage('fuel') && !onPage('engine'))) return;
    lpfpUdsTurn++;
    if (lpfpUdsTurn % 2 === 1) {
        askDme('58F3', [0x22, 0x58, 0xF3], (u) => {
            if (!u || u[0] !== 0x62 || u.length < 5) return;
            const raw = (u[3] << 8) | u[4];
            const bar = raw * 0.1 / 100; // table: ×0.1 kPa → bar
            if (bar >= 0 && bar < 20) o.lpfp = { value: bar, at: Date.now() };
        });
    } else {
        askDme('5463', [0x22, 0x54, 0x63], (u) => {
            if (!u || u[0] !== 0x62 || u.length < 5) return;
            let raw = (u[3] << 8) | u[4];
            if (raw > 32767) raw -= 65536; // s16
            const bar = raw / 1000; // hPa → bar
            if (bar >= 0 && bar < 20) o.lpfp = { value: bar, at: Date.now() };
        });
    }
}
function readEthanol() {
    // Probe rotation: 5939/5938/550D/F452/593A(+debug) and forced OBD 52. Settings ethDebug always updates.
    if (Date.now() > activeUntil) return;
    if (obdFresh('ethanol') && typeof obdVal('ethanol') === 'number') {
        ethMod.fromObd52Byte(obdVal('ethanol'), ethanol);
    }
    if (tasu && !ethObdQueued) {
        ethObdQueued = true;
        queue.push({ target: DME, pids: [0x52] });
        if (!pending) setTimeout(obdTick, 0);
    }
    if (!tasu) return;
    const probes = ethMod.PROBES;
    const probe = probes[ethUdsTurn % probes.length];
    ethUdsTurn++;
    askDme(probe.key, probe.bytes.slice(), (u) => {
        const had = ethanol.pct != null && Date.now() - ethanol.at < 5000;
        const prevPct = ethanol.pct, prevSrc = ethanol.src, prevAt = ethanol.at;
        const ok = probe.apply(u, ethanol);
        // 593A is debug-only; never let a failed probe clear a good value
        if (had && !ok) { ethanol.pct = prevPct; ethanol.src = prevSrc; ethanol.at = prevAt; }
    });
}

function readGroups() {
    if (groupsBusy || !onPage('details')) return;
    groupsBusy = true; groupsAsked = 0;
    const at = Date.now();      // the pass's start (render: not shown after a pause)
    let left = false;
    groups.readAll((did) => {
        // the page left (or paused): the pass stops here, nothing more is asked (and nothing counts as refused)
        if (!onPage('details')) { left = true; return Promise.reject(new Error('page left')); }
        groupsAsked++;
        return udsRead(DME, [0x22, did >> 8, did & 255]).then((u) => {
            if (u && u[0] === 0x62) return u.slice(3);
            if (u && u[0] === 0x7F && (u[2] === 0x31 || u[2] === 0x12)) return null;   // refused: never asked again
            throw new Error(u ? `NRC ${hex(u[2])}` : 'no answer');                       // asked again on the next pass
        });
    }).then((r) => {
        if (left) return;       // a part pass is not shown
        groupsRes = Object.assign(r, { at });
        if (!r.read) groups.refused.clear();     // nothing answered (the DME asleep?): every identifier again next pass
    }, (e) => log(`details: ${errText(e)}`)).then(() => { groupsBusy = false; });
}

// ---- Transmission (transmission.js, read-only): the variant first; live values every second, the clutch adaptations
// and the oil temperature history once a visit; nothing but 22 F150 on a variant it does not know
const trans = { id: null, live: null, adapt: null, hist: null };
let transBusy = false, picsKey = '', pics = [];
function readTrans() {
    if (transBusy || !onPage('transmission')) return;
    transBusy = true;
    const read = (addr, bytes) => udsRead(addr, bytes);
    const known = trans.id && (trans.id.supported || trans.id.variant);
    (known ? Promise.resolve(trans.id) : transmission.identify(read).then((x) => (trans.id = x)))
        .then((id) => id.supported && transmission.readLive(read, id).then((l) => { trans.live = l; })
            .then(() => trans.adapt || transmission.readAdaptations(read, id).then((a) => { trans.adapt = a; }))
            .then(() => trans.hist || transmission.readHistory(read, id).then((h) => { trans.hist = h; })))
        .catch((e) => log(`transmission: ${errText(e)}`))
        .then(() => { transBusy = false; });
}
// ---- DPF (dpf.js, read-only): while its page shows, the fast values every second, the rest every 10 s, the history once a
// visit (and after a regeneration), one 22 after the other; a regeneration seen to burn the soot off teaches its start
let dpfBusy = false;
function readDpf() {
    if (dpfBusy || !onPage('dpf')) return;
    dpfBusy = true;
    filt.due(Date.now()).reduce((p, k) => p.then(() => {
        const q = filt.request(k);
        return q && onPage('dpf') && udsRead(DME, q).then((u) => {
            if (filt.got(k, u, Date.now())) { log(`dpf: regeneration start learned at ${filt.learned[0].toFixed(1)} g`); saveSettings(); }
        });
    }), Promise.resolve())
        .catch((e) => log(`dpf: ${errText(e)}`))
        .then(() => { dpfBusy = false; });
}

// its two pictures (tabs.js), made again only when what they show changed
function transPictures() {
    const bars = tabs.clutchBars(trans.adapt), bands = tabs.oilBands(trans.hist), key = JSON.stringify([bars, bands]);
    if (key === picsKey) return;
    picsKey = key;
    const { makeImage, dropImage } = runtime('kit/record.js'), pic = (p) => makeImage(p.w, p.h, p.data);
    pics.forEach(dropImage);
    pics = [pic(tabs.clutchPixels(bars)), pic(tabs.bandPixels(bands))];
    screens.setImage('clutches', pics[0]).setImage('oilBands', pics[1]);
}

// the app's values on the screens (ScreenApp.set: drawn only when the shown screen changed)
const setAll = (v) => Object.keys(v).forEach((n) => screens.set(n, v[n]));
function render() {
    if (!screens || !screens.st) return;
    refreshEnds();
    const rpm = rnd(V.rpm()), boost = rnd(V.boost(), 2), nm = rnd(V.torque()), kmh = rnd(V.speed());
    const hp = rnd(V.power() === undefined ? undefined : V.power() * 1.341);
    // a tick (and its number) every 1000 rpm, 0.5 bar, 100 hp / Nm; a bar end between two of them ends the scale there
    const eth = V.ethanol();
    const ethShow = eth === null || eth === undefined ? null : eth;   // teleMiniTile shows blank/null as --
    peak('rpm', rpm); peak('boost', boost); peak('hp', hp); peak('nm', nm);
    screens.set('rpmBar', { value: rpm, max: ends.rpm, redFrom: redFrom('rpm'), ticks: Math.max(4, ends.rpm / 1000),
            div: 1000, label: 'RPM', unit: 'rpm', decimals: 0 })
        .set('boostBar', { value: boost, max: ends.boost, redFrom: redFrom('boost'), ticks: 5,
            label: 'Boost', unit: 'bar', decimals: 2 })
        .set('powerBar', { value: hp, peak: peak('hp', hp), label: withPeak('hp'), max: ends.power, limit: redFrom('power'), ticks: ends.power / 100 })
        .set('torqueBar', { value: nm, peak: peak('nm', nm), label: withPeak('nm'), max: ends.torque, limit: redFrom('torque'), ticks: ends.torque / 100 })
        .set('speed', { value: kmh === undefined ? '--' : String(kmh), color: kmh === undefined ? 'dim' : '' })
        .set('gear', { text: gearShown(), color: rpm === undefined ? '#4a4f57' : '#ffb020' })
        .set('engineMenu', Date.now() > activeUntil ? { chips: [['Paused', 'warn']], sub: 'Paused · open a tab to resume' }
            : rpm === undefined ? { chips: [['DME not answering', 'crit']], sub: 'Waiting for the DME' } : { chips: [], sub: 'Quiet Dials · live' })
        .set('oilBar', { value: rnd(V.oil()), max: ends.oil })
        .set('coolantBar', { value: rnd(V.coolant()), max: ends.coolant })
        .set('intakeBar', { value: rnd(V.iat()), max: ends.intake })
        .set('batteryBar', { value: rnd(V.volt(), 1) })
        .set('ethanolBar', { value: ethShow, label: ethMod.label(), unit: '%', dec: 0 })
        .set('peakKv', { rows: [
            ['RPM peak', peaks.rpm === undefined ? '--' : String(Math.round(peaks.rpm))],
            ['Boost peak', peaks.boost === undefined ? '--' : peaks.boost.toFixed(2)],
            ['Power peak', peaks.hp === undefined ? '--' : String(Math.round(peaks.hp))],
            ['Torque peak', peaks.nm === undefined ? '--' : String(Math.round(peaks.nm))],
            ['Ethanol', ethMod.displayText(ethanol).replace(/^Ethanol /, '') + (ethanol.src ? ` · ${ethanol.src}` : '')],
        ] });
    // auto-log ring (always while polling window active)
    if (Date.now() <= activeUntil) {
        ring.sample({
            rpm, v: kmh, tq: nm, boost, ect: rnd(V.coolant()), oil: rnd(V.oil()), batt: rnd(V.volt(), 1),
            gear: gearShown(), mode: STAGENAME[raw.viStage] || '', run: engineRun(), ethanol: ethShow,
        });
    }
    // the page shown (tabs.js): its values only; paused (as Engine): each frame says so, no values. A read that began
    // before the last pause (its at) is not shown after it either
    const pg = screens.st.name, now = Date.now(), paused = now > activeUntil, cur = (x) => (x && x.at >= activeSince ? x : null);
    if (pg === 'fuel') {
        setAll(tabs.fuelView(series, fuelNow(), paused, ethShow));
        // Quiet Dials strip: short label + value/-- % (never a wide miniTile with value on the far right)
        screens.set('ethanolFuel', {
            value: ethShow == null ? '--' : String(ethShow),
            unit: '%', size: 64, color: ethShow == null ? 'dim' : '', align: 'left',
        });
        screens.set('ethanolFuelSrc', { text: ethMod.sourceLine(ethanol) });
    }
    if (pg === 'trips') setAll(tabs.tripsView({ tc, now, period: tripPeriod, currency, flow: tripFlow(now), running: /^(running|starting)$/.test(engineRun() || ''), paused }));
    if (pg === 'transmission') { setAll(tabs.transView(Object.assign({}, trans, { live: cur(trans.live), paused }))); transPictures(); }
    if (pg === 'dpf') setAll(dpf.view(filt, now, paused));
    if (pg === 'adjust') setAll(ensureAdjust().view(paused));
    syncTabs();
    if (pg === 'details') setAll(tabs.detailsView(cur(groupsRes), groupsAsked, GROUP_DIDS, linkRows(), paused));
    // Settings: the bar ends (the engine-speed one by the engine type until set by hand), the fuel price, the currency
    const auto = (k) => (k === 'rpm' && !('rpm' in custom) && engineType() ? ` · ${engineType()}` : '');
    Object.keys(RANGES).forEach((k) => screens.set(`${k}Max`, UNITS[k] ? { value: ends[k], sub: `Red zone from ${redFrom(k)} ${UNITS[k]}${auto(k)}` } : { value: ends[k] }));
    screens.set('priceText', { text: tc.price ? tc.price.toFixed(2) : '--' }).set('currencyRow', { text: currency });
    const st = ring.status();
    screens.set('logStatus', { text: st.note || `Ringbuffer · ${st.mb} MB` });
    screens.set('ethDebug', { rows: ethMod.debugRows(ethanol) });
}

// the tabs: engine is the app's first screen, the other pages open over it (BACK returns to engine)
function goTo(page) {
    const cur = screens.st && screens.st.name;
    if (!page || page === cur) return;
    if (cur && cur !== 'engine') closeScreen(cur);
    if (page !== 'engine') showScreen(page);
}
function onChange(name, o) {
    const k = name.replace(/Max$/, '');
    if (k !== name && RANGES[k]) { custom[k] = snap(k, o.value); saveSettings(); render(); return; }   // a settings slider: by hand
    if (name === 'tripPeriod') { tripPeriod = o.sel; render(); return; }                                 // Trips: today / 7 / 30 days
    if (name === 'mapSeg' || name === 'flapSeg' || name === 'coolSeg') {                                 // Adjust: map / flap / cooling
        ensureAdjust().onChange(name, o);
        render();
        return;
    }
    let from = name.replace(/Menu$/, '');
    if (from === name) from = name.replace(/Tabs$/, '');
    if (from === name || PAGES.indexOf(from) < 0) return;
    const shown = shownPages(), to = shown[o.sel];
    screens.set(`${from}Menu`, { sel: shown.indexOf(from), hideTabs: true });
    screens.set(`${from}Tabs`, { sel: shown.indexOf(from) });
    goTo(to);
}

// ---- RHMI: the host states --------------------------------------------------------------------
let app = null;
const comp = (n) => app.getByName(n);
const log = (m) => console.error(LOG, m);
function showScreen(name) {
    return comp(name).updateResources().then(() => app.openState(name))
        .catch((e) => log(`open ${name} failed: ${errText(e)}`));
}
const closeScreen = (name) => app.closeState(name).catch((e) => log(`close ${name} failed: ${errText(e)}`));

// polling + OBD run while a screen shows: every screen change renews the window, hidden / closed ends it
function activate() {
    const wasIdle = Date.now() > activeUntil;
    activeUntil = Date.now() + ACTIVE_WINDOW_MS;
    if (wasIdle) {                                   // the 5 minutes start again
        activeSince = Date.now();
        [series, filt.series].forEach((s) => Object.keys(s).forEach((k) => { s[k].length = 0; }));
    }
    if (wasIdle && !pending) setTimeout(obdTick, 0);
}

function startScreens(rhmiApp, hosts) {
    app = rhmiApp;
    const design = JSON.parse(fs.readFileSync(path.join(RENDERER, 'screens.json'), 'utf8'));
    const { RenderClient } = runtime('kit/renderd.js');
    const { ScreenApp } = runtime('screenapp.js');
    const rlog = { info: log, warn: log, error: log };
    const gpu = new RenderClient('kingkong_cardata', rlog);
    screens = new ScreenApp(gpu, design, { view: 'id8', log: rlog });
    // a host state per screen: the HMI shows it -> the screen shows; BACK / HOME / popups through them
    screens.bindHosts(hosts, { open: (name) => showScreen(name), close: closeScreen });
    screens.on('show', (name) => {
        activate();
        if (name === 'engine') peaks = {};                                          // the peaks count from here (spec 5)
        if (name === 'transmission') {                                              // read again on every visit
            trans.adapt = null; trans.hist = null;
            if (trans.id && !trans.id.supported) trans.id = null;
        }
        if (name === 'dpf') filt.visit();                                           // its history read again
        if (name === 'adjust') ensureAdjust().onShow();                             // MHD status reset + flap/rpm poll
        render();                                                                   // its values in its first frame
    });
    // the app came back from the background with its screen still up: the HMI shows the host state again
    PAGES.forEach((s) => hosts[s].on('visible', (ev) => { if (ev && (ev.visible === true || ev.visible === 'true' || ev.visible === 1)) activate(); }));
    screens.on('change', onChange);
    screens.on('event', (e) => {
        if (e === 'reset') { custom = {}; saveSettings(); }                        // Restore defaults: the bar ends
        if (e === 'priceDown' || e === 'priceUp') {                                 // the fuel price, 0.01 a tap (kept with the trips)
            tc.setPrice(Math.max(0, Math.round((tc.price + (e === 'priceUp' ? 0.01 : -0.01)) * 100) / 100));
            saveTrips();
        }
        if (e === 'currency') { currency = CURRENCIES[(CURRENCIES.indexOf(currency) + 1) % CURRENCIES.length]; saveSettings(); }
        if (e === 'sendLog') {
            const r = ring.exportPackage();
            log(`send-log: ${r.note}`);
            screens.set('logStatus', { text: r.note });
        }
        render();
    });
    // the user left for the HMI (touched it): leave the host states too, or the HMI would show their empty pages
    screens.on('closed', (why) => { activeUntil = 0; if (why !== 'hmi') PAGES.slice().reverse().forEach(closeScreen); });
    gpu.connect();
}

// ---- lifecycle: the shared OnlineApp host (start, tile -> engine, shutdown; iDrive 8 since 1.2.0) ---------------------
// The sources, the TASU link and the render loop start with the screens; the host opens the entry state on a tile tap.
// Hidden (the app went to the background): polling and OBD stop; the next screen shown resumes them.
createHost({
    states: PAGES,                           // the entry state (engine) first
    log,
    onReady: (rhmiApp, hosts) => {
        startScreens(rhmiApp, hosts);
        Object.keys(SOURCES).forEach(connect);
        connectTasu();
        setInterval(render, RENDER_MS);      // while a screen is shown (ScreenApp.set draws only what changed)
        setInterval(() => {   // changes per second over the last 5 s
            for (const k of Object.keys(hits)) { rates[k] = hits[k] / 5; hits[k] = 0; }
        }, 5000);
        setInterval(tripTick, 500);                                                 // Trips, also with the screens closed
        setInterval(() => { readFuelRef(); readBoostTarget(); readEthanol(); readLpfp(); readTrans(); readDpf(); }, 1000);
        setInterval(() => { if (onPage('adjust')) ensureAdjust().poll().then(() => render()); }, 2000);
        setInterval(readGroups, 2000);
        setInterval(() => { sampleSeries(); if (onPage('dpf')) filt.sample(Date.now()); }, 5000);
    },
    onHidden: () => { activeUntil = 0; },
    onShutdown: () => { if (tc.ver !== tripsSaved) saveTrips(); try { ring.close(); } catch (e) { /* */ } },
});
