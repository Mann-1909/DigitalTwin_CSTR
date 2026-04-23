import asyncio
import random
import math
import csv
import os
import datetime
from fastapi.responses import FileResponse
import numpy as np
from scipy.integrate import solve_ivp
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

class CSTRLogger:
    def __init__(self, log_dir="../logging"):
        self.log_dir = log_dir
        os.makedirs(self.log_dir, exist_ok=True)
        # Updated headers: Fin split into Fa and Fb; Ca0/Cb0 renamed to Ca_feed/Cb_feed
        self.headers = [
            "Serial_No", "Time",
            "Fa", "Fb", "Ca_feed", "Cb_feed", "T0", "Q", "Tcin", "Fc",
            "Ca", "Cb", "Cc", "Cd", "T", "Tc", "h",
            "Xa", "Fin", "Ca0_eff", "Keq", "k_f", "k_r", "rate_net"
        ]
        self.latest_file = None
        self.reset_log()

    def reset_log(self):
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.latest_file = os.path.join(self.log_dir, f"cstr_log_{timestamp}.csv")
        self.serial_no = 1
        
        with open(self.latest_file, mode='w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(self.headers)

    def log_data(self, cpu_time_str, inputs, outputs):
        Fa      = inputs.get("Fa", 0)
        Fb      = inputs.get("Fb", 0)
        Fin     = Fa + Fb
        Ca_feed = inputs.get("Ca_feed", 0)
        Cb_feed = inputs.get("Cb_feed", 0)
        Ca0_eff = (Fa * Ca_feed / Fin) if Fin > 0 else 0.0
        row = [
            self.serial_no, cpu_time_str,
            Fa, Fb, Ca_feed, Cb_feed,
            inputs.get("T0", 0), inputs.get("Q", 0), inputs.get("Tcin", 0), inputs.get("Fc", 0),
            outputs.get("Ca", 0), outputs.get("Cb", 0), outputs.get("Cc", 0), outputs.get("Cd", 0),
            outputs.get("T", 0), outputs.get("Tc", 0), outputs.get("h", 0),
            outputs.get("Xa", 0), round(Fin, 8), round(Ca0_eff, 4),
            outputs.get("Keq", 0), outputs.get("k_f", 0), outputs.get("k_r", 0), outputs.get("rate_net", 0)
        ]
        with open(self.latest_file, mode='a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(row)
        self.serial_no += 1

app = FastAPI()

@app.get("/")
async def health_check():
    return {"status": "online", "message": "Digital Twin Backend is running"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CSTRDigitalTwin:
    def __init__(self):
        # ── Kinetics (forward, Arrhenius) ──────────────────────────────────────
        # Reaction: A + B ⇌ C + D  (exothermic, reversible)
        self.k0    = 3.4e4        # Pre-exponential factor [m³/(mol·s)]
        self.E     = 45000.0      # Activation energy, forward  [J/mol]
        self.R     = 8.314        # Gas constant  [J/(mol·K)]

        # ── Thermodynamics (equilibrium constant via Van't Hoff) ───────────────
        # Keq(T) = Keq_ref * exp( ΔH/R * (1/T_ref − 1/T) )
        # For exothermic ΔH < 0: Keq decreases with rising T  →  conversion
        # approaches a temperature-dependent saturation ceiling.
        self.deltaH  = -50000.0   # Enthalpy of reaction  [J/mol]  (exothermic)
        self.Keq_ref = 1000.0     # Equilibrium constant at T_ref  [dimensionless]
        self.T_ref   = 293.0      # Reference temperature  [K]

        # ── Thermal / physical properties ──────────────────────────────────────
        self.rho   = 1000.0       # Liquid density  [kg/m³]
        self.Cp    = 4180.0       # Specific heat   [J/(kg·K)]

        # ── Heat-exchanger / coolant jacket ────────────────────────────────────
        self.U     = 500.0        # Overall HTC  [W/(m²·K)]
        self.A     = 2.5          # Heat-transfer area  [m²]  (500 L reactor)
        self.rho_c = 1000.0
        self.Cpc   = 4180.0
        self.Vc    = 0.1          # Coolant jacket volume  [m³]

        # ── Reactor geometry ────────────────────────────────────────────────────
        self.Ar    = 0.5          # Cross-sectional area  [m²]
        self.kv    = 0.02         # Outlet valve coefficient (Fout = kv*√h)

        # ── Initial state  [Ca, Cb, Cc, Cd, T, Tc, h] ─────────────────────────
        # Ca & Cb initialised at Ca0_eff = Fa·Ca_feed/(Fa+Fb) = 0.01·100/0.02 = 50 mol/m³
        # (effective mixed-inlet concentration with default Fa=Fb=0.01)
        self.state = [50.0, 50.0, 0.0, 0.0, 293.0, 293.0, 1.0]
        self.time  = 0.0

    # ── Equilibrium constant ────────────────────────────────────────────────────
    def _Keq(self, T):
        """Van't Hoff equilibrium constant.
        Decreases with T for an exothermic reaction (ΔH < 0), producing the
        observed temperature-saturation of conversion."""
        exponent = (self.deltaH / self.R) * (1.0 / self.T_ref - 1.0 / T)
        return self.Keq_ref * math.exp(exponent)

    def odes(self, t, y, Fa, Fb, Ca_feed, Cb_feed, T0, Q, Tcin, Fc):
        Ca, Cb, Cc, Cd, T, Tc, h = y

        # ── Safety clamps ────────────────────────────────────────────────────
        h  = max(1e-4, h)
        Ca = max(0.0, Ca)
        Cb = max(0.0, Cb)
        Cc = max(0.0, Cc)
        Cd = max(0.0, Cd)

        # ── Derived quantities ───────────────────────────────────────────────
        Fin  = Fa + Fb                                  # total volumetric flow [m³/s]
        V    = self.Ar * h                              # liquid volume [m³]
        Fout = self.kv * math.sqrt(h)                   # outlet flow [m³/s]

        # ── Rate constants ───────────────────────────────────────────────────
        k_f  = self.k0 * math.exp(-self.E / (self.R * T))
        Keq  = self._Keq(T)
        k_r  = k_f / max(Keq, 1e-10)                   # reverse rate constant

        # ── Net reaction rate  r = k_f·Ca·Cb − k_r·Cc·Cd ────────────────────
        # Positive → forward (consuming A & B)
        # Negative → reverse (consuming C & D) – physically allowed
        rate = k_f * Ca * Cb - k_r * Cc * Cd

        # ── Molar balances (two separate feed inlets) ────────────────────────
        # dCa/dt = (Fa·Ca_feed − Fin·Ca)/V  − rate
        # dCb/dt = (Fb·Cb_feed − Fin·Cb)/V  − rate
        dCa_dt = (Fa * Ca_feed - Fin * Ca) / V - rate
        dCb_dt = (Fb * Cb_feed - Fin * Cb) / V - rate
        dCc_dt = (-Fin * Cc) / V + rate
        dCd_dt = (-Fin * Cd) / V + rate

        # ── Energy balance ────────────────────────────────────────────────────
        dT_dt = (
            (Fin / V) * (T0 - T)
            + (-self.deltaH / (self.rho * self.Cp)) * rate
            - (self.U * self.A / (self.rho * self.Cp * V)) * (T - Tc)
            + Q / (self.rho * self.Cp * V)
        )

        # ── Coolant jacket ────────────────────────────────────────────────────
        dTc_dt = (
            (Fc / self.Vc) * (Tcin - Tc)
            + (self.U * self.A / (self.rho_c * self.Cpc * self.Vc)) * (T - Tc)
        )

        # ── Level balance ─────────────────────────────────────────────────────
        dh_dt = (Fin - Fout) / self.Ar

        return [dCa_dt, dCb_dt, dCc_dt, dCd_dt, dT_dt, dTc_dt, dh_dt]

    def step(self, dt, inputs):
        # ── Unpack inputs (Fa & Fb separate) ─────────────────────────────────
        Fa      = inputs.get("Fa", 0.01)
        Fb      = inputs.get("Fb", 0.01)
        Ca_feed = inputs.get("Ca_feed", 100.0)   # conc. of A in feed stream A
        Cb_feed = inputs.get("Cb_feed", 100.0)   # conc. of B in feed stream B
        T0      = inputs.get("T0", 293.0)
        Q       = inputs.get("Q", 0.0)
        Tcin    = inputs.get("Tcin", 293.0)
        Fc      = inputs.get("Fc", 0.01)

        sol = solve_ivp(
            self.odes,
            [self.time, self.time + dt],
            self.state,
            args=(Fa, Fb, Ca_feed, Cb_feed, T0, Q, Tcin, Fc),
            method='Radau',
            rtol=1e-5, atol=1e-7
        )

        self.state = sol.y[:, -1]
        # Clamp concentrations to non-negative
        for i in range(4):
            self.state[i] = max(0.0, self.state[i])
        self.time += dt

        Ca, Cb, Cc, Cd, T, Tc, h = self.state

        # ── Conversion (fraction of A fed that has reacted) ──────────────────
        # Xa = 1 − (Fout · Ca) / (Fa · Ca_feed)
        # Equivalent: Xa = (Ca0_eff − Ca) / Ca0_eff  where Ca0_eff = Fa·Ca_feed/(Fa+Fb)
        Fin    = Fa + Fb
        Ca0_eff = (Fa * Ca_feed / Fin) if Fin > 0 else 0.0
        Xa = 1.0 - Ca / Ca0_eff if Ca0_eff > 1e-10 else 0.0
        Xa = max(0.0, min(1.0, Xa))

        # ── Diagnostics for CSV ───────────────────────────────────────────────
        k_f   = self.k0 * math.exp(-self.E / (self.R * T))
        Keq   = self._Keq(T)
        k_r   = k_f / max(Keq, 1e-10)
        rate_net = k_f * Ca * Cb - k_r * Cc * Cd

        return {
            "Ca": float(Ca), "Cb": float(Cb),
            "Cc": float(Cc), "Cd": float(Cd),
            "T":  float(T),  "Tc": float(Tc),
            "h":  float(h),
            "Xa": float(Xa * 100.0),   # return as percentage
            "Keq":      round(Keq, 4),
            "k_f":      round(k_f, 6),
            "k_r":      round(k_r, 6),
            "rate_net": round(rate_net, 6),
        }

twin = CSTRDigitalTwin()
logger = CSTRLogger()
sim_state = {"is_running": False}

gui_inputs = {
    "mode":    "Simulation",
    # Feed stream A (carries reactant A at Ca_feed mol/m³)
    "Fa":      0.01,    # m³/s
    # Feed stream B (carries reactant B at Cb_feed mol/m³)
    "Fb":      0.01,    # m³/s
    "Ca_feed": 100.0,   # mol/m³  – concentration of A in feed stream A
    "Cb_feed": 100.0,   # mol/m³  – concentration of B in feed stream B
    "T0":      293.0,   # K
    "Q":       0.0,     # W
    "Tcin":    293.0,   # K
    "Fc":      0.01,    # m³/s
}

@app.post("/update_inputs")
async def update_inputs(inputs: dict):
    global gui_inputs
    gui_inputs.update(inputs)
    return {"status": "success"}

@app.post("/control")
async def control_sim(command: dict):
    global sim_state, twin, logger
    cmd = command.get("action")
    
    if cmd == "start":
        sim_state["is_running"] = True
    elif cmd == "stop":
        sim_state["is_running"] = False
    elif cmd == "reset":
        sim_state["is_running"] = False
        twin = CSTRDigitalTwin() 
        logger.reset_log()       
        
    return {"status": "success"}

@app.get("/download_log")
async def download_log():
    if logger.latest_file and os.path.exists(logger.latest_file):
        return FileResponse(
            path=logger.latest_file, 
            filename=os.path.basename(logger.latest_file), 
            media_type='text/csv'
        )
    return {"error": "Log file not generated yet."}

@app.websocket("/ws/cstr_data")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            if sim_state["is_running"]:
                dt = 1.0 
                sim_data = twin.step(dt, gui_inputs)

                current_time = datetime.datetime.now().strftime("%H:%M:%S")

                payload = {
                    "time": current_time,
                    "mode": gui_inputs["mode"],
                }

                for key, val in sim_data.items():
                    payload[f"simulated_{key}"] = round(val, 4)
                    noise_margin = val * 0.015
                    payload[f"experimental_{key}"] = round(val + random.uniform(-noise_margin, noise_margin), 4)

                if gui_inputs["mode"] == "Experiment":
                    payload["live_inputs"] = {
                        "Fa":      round(gui_inputs["Fa"]      * (1 + random.uniform(-0.02, 0.02)), 8),
                        "Fb":      round(gui_inputs["Fb"]      * (1 + random.uniform(-0.02, 0.02)), 8),
                        "Ca_feed": round(gui_inputs["Ca_feed"] + random.uniform(-0.1, 0.1), 2),
                        "Cb_feed": round(gui_inputs["Cb_feed"] + random.uniform(-0.1, 0.1), 2),
                        "T0":      round(gui_inputs["T0"]      + random.uniform(-0.5, 0.5), 2),
                        "Q":       round(gui_inputs["Q"]       + random.uniform(-5.0, 5.0), 2),
                        "Tcin":    round(gui_inputs["Tcin"]    + random.uniform(-0.5, 0.5), 2),
                        "Fc":      round(gui_inputs["Fc"]      * (1 + random.uniform(-0.02, 0.02)), 8),
                    }

                logger.log_data(current_time, gui_inputs, sim_data)
                await websocket.send_json(payload)

            await asyncio.sleep(1.0) 

    except Exception as e:
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)