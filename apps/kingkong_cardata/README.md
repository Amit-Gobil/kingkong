# Kingkong (`kingkong_cardata`)

iDrive 8 live data for Kingkong Tuning (M3 G81). Quiet Dials skin, bottom tabs, ethanol %, Send log. **English-only UI.**

- **Engine** — Quiet Dials RPM/Boost, power, torque, temps, battery, ethanol as `Ethanol XX %` / `Ethanol -- %` (Fuel+Engine); probes 5939/5938/550D/F452/593A; Settings ethDebug; LPFP UDS fallback  
- **Fuel** — intake / fuel pressures / timing / boost with 5‑minute traces + ethanol % (same sources)  
- **Transmission** — ZF 8HP read-only (experimental)  
- **Adjust** — MHD maps 1–4, Max Cooling, exhaust flap (Iterio Live Adjustments logic; Quiet Dials UI)  
- **Settings** — bar ends (power ≤1500 hp, torque ≤1700 Nm), fuel price, currency, Send log (30 min ringbuffer)  
- *Hidden (flag `SHOW_TRIPS_DETAILS`)*: **Trips**, **Details** — screens/logic still shipped; flip flag + repack to restore  


Install via MGU Store from source `Amit-Gobil/kingkong` (see repo root README).
