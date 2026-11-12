// Ported from cauliflowermossgrape/idrive7-apps (MIT License, Copyright (c) 2026 cauliflowermossgrape): apps/live_data/useful.js, builtin/DME8FF_R.json @ c67ea17.
'use strict';
// engine-groups.js's catalog as a module (it was engine-groups.json: make_source_pkg.js stages .js modules only).
module.exports = {
  "sgbd": "DME8FF_R",
  "about": "Engine unit (0x12) values for Kingkong Details, UDS 22 only. Ported from cauliflowermossgrape/idrive7-apps (MIT) apps/live_data/useful.js + builtin/DME8FF_R.json @ c67ea17, checked against PRG FILES/dme8ff_r.prg. Item: name, unit (shown), d (decimals), c (candidates, best first: did, t type, at byte offset, k, o, u SGBD unit, m bit mask, le low byte first, e value table), minus [a, b] (a - b), bad (raw values that mean no data), lin [a, b] (a + b x value).",
  "groups": [
    { "group": "Engine", "items": [
      { "name": "Engine speed", "unit": "rpm", "d": 0, "c": [{ "did": "4807", "t": "s16", "k": 0.5, "u": "rpm" }] },
      { "name": "Accelerator pedal", "unit": "%", "d": 0, "c": [{ "did": "5814", "t": "s16", "k": 0.01220703, "u": "%" }, { "did": "480B", "t": "s16", "k": 0.01220703, "u": "%" }] },
      { "name": "Throttle", "unit": "%", "d": 0, "c": [{ "did": "4600", "t": "s16", "k": 0.0078125, "u": "%" }, { "did": "5858", "t": "s16", "k": 0.0078125, "u": "%" }] },
      { "name": "Engine torque", "unit": "Nm", "d": 0, "c": [{ "did": "5891", "t": "s16", "k": 0.5, "u": "Nm" }, { "did": "5717", "t": "s16", "k": 0.1, "u": "Nm" }] },
      { "name": "Engine power (engine unit)", "unit": "", "d": 0, "c": [{ "did": "4520", "t": "u16", "k": 0.015258789062 }] },
      { "name": "Vehicle speed", "unit": "km/h", "d": 0, "c": [{ "did": "4AB1", "t": "s16", "k": 0.01, "u": "km/h" }] },
      { "name": "Gear", "unit": "", "d": 0, "c": [{ "did": "5881", "t": "u8" }, { "did": "564F", "t": "u8" }] }
    ] },
    { "group": "Temperatures", "items": [
      { "name": "Coolant", "unit": "°C", "d": 0, "c": [{ "did": "4300", "t": "s16", "k": 0.1, "o": -273.14, "u": "°C" }, { "did": "5805", "t": "s16", "k": 0.1, "o": -273.14, "u": "°C" }] },
      { "name": "Coolant, radiator outlet", "unit": "°C", "d": 0, "c": [{ "did": "5890", "t": "u8", "k": 0.75, "o": -48, "u": "°C" }] },
      { "name": "Engine oil (after filter)", "unit": "°C", "d": 0, "c": [{ "did": "4402", "t": "u16", "k": 0.75, "o": -48, "u": "°C" }, { "did": "5822", "t": "u8", "o": -60, "u": "°C" }] },
      { "name": "Engine oil in the sump", "unit": "°C", "d": 0, "c": [{ "did": "4425", "t": "s16", "k": 0.1, "u": "°C" }, { "did": "4408", "t": "s16", "k": 0.1, "o": -273.14, "u": "°C" }] },
      { "name": "Intake air", "unit": "°C", "d": 0, "c": [{ "did": "580F", "t": "u8", "k": 0.75, "o": -48, "u": "°C" }] },
      { "name": "Charge air before throttle", "unit": "°C", "d": 0, "c": [{ "did": "59D4", "t": "u16", "k": 0.0234375, "o": -273.15, "u": "°C" }] },
      { "name": "Outside", "unit": "°C", "d": 1, "c": [{ "did": "5817", "t": "s16", "k": 0.1, "o": -273.14, "u": "°C" }, { "did": "5512", "t": "u8", "k": 0.5, "o": -40, "u": "°C" }] },
      { "name": "Gearbox", "unit": "°C", "d": 0, "c": [{ "did": "4650", "t": "u8", "k": 0.75, "o": -48, "u": "°C" }] },
      { "name": "Fuel", "unit": "°C", "d": 0, "c": [{ "did": "4AD5", "t": "u8", "k": 0.75, "o": -48, "u": "°C" }] },
      { "name": "Engine unit", "unit": "°C", "d": 0, "c": [{ "did": "5821", "t": "u8", "k": 0.75, "o": -48, "u": "°C" }] },
      { "name": "Exhaust after catalyst (model)", "unit": "°C", "d": 0, "c": [{ "did": "5896", "t": "s16", "k": 0.1, "o": -273.14, "u": "°C" }, { "did": "582F", "t": "s16", "k": 0.1, "o": -273.14, "u": "°C" }] },
      { "name": "Particulate filter", "unit": "°C", "d": 0, "c": [{ "did": "579B", "t": "s16", "k": 0.1, "o": -273.14, "u": "°C" }] }
    ] },
    { "group": "Oil", "items": [
      { "name": "Oil pressure", "unit": "bar", "d": 2, "minus": [{ "did": "4436", "t": "u16", "u": "hPa" }, { "did": "4201", "t": "u16", "k": 0.0390625, "u": "hPa" }] },
      { "name": "Oil pressure (absolute)", "unit": "bar", "d": 2, "c": [{ "did": "586F", "t": "s16", "u": "hPa" }, { "did": "4436", "t": "u16", "u": "hPa" }] },
      { "name": "Oil level above minimum", "unit": "l", "d": 2, "bad": [255], "c": [{ "did": "5811", "t": "u8", "u": "cl" }, { "did": "442F", "t": "u8", "u": "cl" }] },
      { "name": "Oil level", "unit": "mm", "d": 1, "c": [{ "did": "4409", "t": "s16", "k": 0.004, "u": "mm" }] },
      { "name": "Oil life left (by engine hours)", "unit": "%", "d": 0, "c": [{ "did": "411A", "at": 0, "t": "u16", "k": 0.001953125 }] },
      { "name": "Oil life left (by fuel used)", "unit": "%", "d": 0, "c": [{ "did": "411A", "at": 2, "t": "u16", "k": 0.001953125 }] },
      { "name": "Engine hours on this oil", "unit": "h", "d": 0, "c": [{ "did": "411A", "at": 4, "t": "u32", "u": "s" }] },
      { "name": "Distance on this oil", "unit": "km", "d": 0, "c": [{ "did": "4404", "t": "u16", "k": 10, "u": "km" }] },
      { "name": "Fuel in the oil", "unit": "g", "d": 0, "c": [{ "did": "593A", "t": "u16", "k": 0.02133333, "u": "g" }] },
      { "name": "Oil pump duty cycle", "unit": "%", "d": 0, "c": [{ "did": "4AAA", "t": "s16", "k": 0.01220703, "u": "%" }] }
    ] },
    { "group": "Fuel", "items": [
      { "name": "Fuel in the tank", "unit": "l", "d": 0, "c": [{ "did": "583B", "t": "u8", "u": "l" }] },
      { "name": "Fuel tank, left half", "unit": "l", "d": 1, "c": [{ "did": "5949", "t": "u8", "k": 0.5, "u": "l" }] },
      { "name": "Fuel tank, right half", "unit": "l", "d": 1, "c": [{ "did": "594A", "t": "u8", "k": 0.5, "u": "l" }] },
      { "name": "Time since refuelling", "unit": "h", "d": 1, "c": [{ "did": "57E3", "t": "u16", "u": "min" }] },
      { "name": "High pressure fuel (rail)", "unit": "bar", "d": 0, "c": [{ "did": "58EF", "t": "u16", "k": 0.0005, "u": "MPa" }, { "did": "5658", "t": "u16", "k": 0.002, "u": "MPa" }] },
      { "name": "High pressure fuel target", "unit": "bar", "d": 0, "c": [{ "did": "5837", "t": "u16", "k": 0.0005, "u": "MPa" }, { "did": "56C1", "t": "u16", "k": 0.002, "u": "MPa" }] },
      { "name": "Low pressure fuel", "unit": "bar", "d": 2, "c": [{ "did": "58F3", "t": "u16", "k": 0.1, "u": "kPa" }, { "did": "5463", "t": "s16", "u": "hPa" }] },
      { "name": "Fuel consumption", "unit": "l/h", "d": 1, "c": [{ "did": "5656", "t": "u16", "k": 0.00119209, "u": "ml/s" }] },
      { "name": "Fuel mass flow", "unit": "kg/h", "d": 1, "c": [{ "did": "4521", "t": "u16", "k": 0.1, "u": "kg/h" }] },
      { "name": "Ethanol in the fuel", "unit": "%", "d": 0, "c": [{ "did": "550D", "t": "u8", "k": 0.39215686, "u": "%" }] },
      { "name": "Fuel quality (adapted)", "unit": "RON", "d": 1, "lin": [98, -7], "c": [{ "did": "5776", "t": "u8", "k": 0.00390625 }] }
    ] },
    { "group": "Ignition and knock", "items": [
      { "name": "Ignition angle", "unit": "°", "d": 1, "c": [{ "did": "59FA", "t": "s8", "k": 0.75, "u": "°CA" }] },
      { "name": "Ignition angle, cylinder 1", "unit": "°", "d": 1, "c": [{ "did": "4A49", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Ignition angle, cylinder 2", "unit": "°", "d": 1, "c": [{ "did": "4A4A", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Ignition angle, cylinder 3", "unit": "°", "d": 1, "c": [{ "did": "4A4C", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Ignition angle, cylinder 4", "unit": "°", "d": 1, "c": [{ "did": "4A4D", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Ignition angle, cylinder 5", "unit": "°", "d": 1, "c": [{ "did": "4A4E", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Ignition angle, cylinder 6", "unit": "°", "d": 1, "c": [{ "did": "4A4F", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Knock detected", "unit": "", "d": 0, "c": [{ "did": "4A36", "t": "u8", "e": { "0": "no", "1": "yes" } }] },
      { "name": "Knock control retard (mean)", "unit": "°", "d": 1, "c": [{ "did": "554C", "t": "s8", "k": 0.375, "u": "°CA" }] },
      { "name": "Knock control adaptation", "unit": "°", "d": 1, "c": [{ "did": "554A", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Misfires, cylinder 1", "unit": "", "d": 0, "c": [{ "did": "4B23", "t": "u16" }] },
      { "name": "Misfires, cylinder 2", "unit": "", "d": 0, "c": [{ "did": "4B24", "t": "u16" }] },
      { "name": "Misfires, cylinder 3", "unit": "", "d": 0, "c": [{ "did": "4B25", "t": "u16" }] },
      { "name": "Misfires, cylinder 4", "unit": "", "d": 0, "c": [{ "did": "4B30", "t": "u16" }] },
      { "name": "Misfires, cylinder 5", "unit": "", "d": 0, "c": [{ "did": "4B31", "t": "u16" }] },
      { "name": "Misfires, cylinder 6", "unit": "", "d": 0, "c": [{ "did": "4B32", "t": "u16" }] },
      { "name": "Rough running, cylinder 1", "unit": "rad/s²", "d": 1, "c": [{ "did": "4A30", "t": "s16", "k": 0.0625, "u": "rad/s²" }] },
      { "name": "Rough running, cylinder 2", "unit": "rad/s²", "d": 1, "c": [{ "did": "4A31", "t": "s16", "k": 0.0625, "u": "rad/s²" }] },
      { "name": "Rough running, cylinder 3", "unit": "rad/s²", "d": 1, "c": [{ "did": "4A32", "t": "s16", "k": 0.0625, "u": "rad/s²" }] },
      { "name": "Rough running, cylinder 4", "unit": "rad/s²", "d": 1, "c": [{ "did": "4A33", "t": "s16", "k": 0.0625, "u": "rad/s²" }] },
      { "name": "Rough running, cylinder 5", "unit": "rad/s²", "d": 1, "c": [{ "did": "4A34", "t": "s16", "k": 0.0625, "u": "rad/s²" }] },
      { "name": "Rough running, cylinder 6", "unit": "rad/s²", "d": 1, "c": [{ "did": "4A35", "t": "s16", "k": 0.0625, "u": "rad/s²" }] }
    ] },
    { "group": "VANOS", "items": [
      { "name": "Intake camshaft", "unit": "°", "d": 1, "c": [{ "did": "452E", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Intake camshaft target", "unit": "°", "d": 1, "c": [{ "did": "452B", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Exhaust camshaft", "unit": "°", "d": 1, "c": [{ "did": "452C", "t": "s16", "k": 0.1, "u": "°CA" }] },
      { "name": "Exhaust camshaft target", "unit": "°", "d": 1, "c": [{ "did": "452A", "t": "s16", "k": 0.1, "u": "°CA" }] }
    ] },
    { "group": "Injector corrections", "items": [
      { "name": "Lambda", "unit": "", "d": 3, "bad": [65535], "c": [{ "did": "5889", "t": "u16", "k": 0.000244140625 }, { "did": "5640", "t": "u16", "k": 0.00024414 }] },
      { "name": "Lambda target", "unit": "", "d": 3, "bad": [65535], "c": [{ "did": "5816", "t": "u16", "k": 0.000244140625 }] },
      { "name": "Mixture adaptation (factor)", "unit": "", "d": 3, "c": [{ "did": "4A9D", "t": "u16", "k": 0.000030517578 }] },
      { "name": "Injector flow adaptation (mean)", "unit": "", "d": 3, "c": [{ "did": "546E", "t": "u16", "k": 0.00003052 }] },
      { "name": "Injector correction, cylinder 1", "unit": "", "d": 3, "c": [{ "did": "55B4", "t": "u16", "k": 0.00003052 }] },
      { "name": "Injector correction, cylinder 2", "unit": "", "d": 3, "c": [{ "did": "55B5", "t": "u16", "k": 0.00003052 }] },
      { "name": "Injector correction, cylinder 3", "unit": "", "d": 3, "c": [{ "did": "55B6", "t": "u16", "k": 0.00003052 }] },
      { "name": "Injector correction, cylinder 4", "unit": "", "d": 3, "c": [{ "did": "55B7", "t": "u16", "k": 0.00003052 }] },
      { "name": "Injector correction, cylinder 5", "unit": "", "d": 3, "c": [{ "did": "55B8", "t": "u16", "k": 0.00003052 }] },
      { "name": "Injector correction, cylinder 6", "unit": "", "d": 3, "c": [{ "did": "55B9", "t": "u16", "k": 0.00003052 }] }
    ] }
  ]
}
;
